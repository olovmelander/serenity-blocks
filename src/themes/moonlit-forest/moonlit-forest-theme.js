/**
 * @fileoverview Moonlit Forest Theme - Mystical forest with procedural trees, glowing mushrooms, and moonbeams
 */

import * as THREE from 'three';
import * as WEBGPU from 'three/webgpu';

import { BaseTheme } from '../base-theme.js';
import { MOONLIT_FOREST_TETROMINOS } from './moonlit-forest-tetrominos.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import {
    createMoonlitSkyNodeMaterial,
    createMoonlitMoonNodeMaterial,
    createMoonlitMoonHaloNodeMaterial,
    createMoonlitStarfieldNodeMaterial,
} from './moonlit-forest-materials.js';
import { MoonlitForestPost } from './moonlit-forest-post.js';
import { MoonlitForestFXController } from './moonlit-forest-fx-controller.js';
import { MoonlitForestParticles } from './moonlit-forest-particles.js';

function parseMoonlitFlags() {
    if (typeof window === 'undefined') {
        return {
            forceWebGL: false,
            noPost: false,
            noMRT: false,
            noCompute: false,
            mrtAudit: false,
            debugLogs: false,
            baseline: false,
            seed: null,
            fixedDtMs: null,
            playback: null,
            playbackLoops: 1,
            usePost: false,
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
        const numeric = Number(value);
        return Number.isFinite(numeric) ? numeric : null;
    };
    const readString = (key) => {
        if (!params.has(key)) return null;
        const value = params.get(key);
        if (value === '' || value === null) return null;
        return value.trim();
    };

    const seed = readNumber('moonlitSeed') ?? readNumber('seed');
    const fixedDtMs = readNumber('moonlitFixedDt') ?? readNumber('fixedDt');
    const playbackRaw = readString('moonlitPlayback');
    const playback = playbackRaw ? playbackRaw.toLowerCase() : null;
    let playbackSequence = null;
    if (playback === 'default' || playback === 'stress') {
        playbackSequence = playback;
    }
    const playbackLoopsRaw = readNumber('moonlitPlaybackLoops');
    const playbackLoops = Number.isFinite(playbackLoopsRaw) && playbackLoopsRaw > 0
        ? Math.floor(playbackLoopsRaw)
        : 1;

    return {
        forceWebGL: readBool('forceWebGL'),
        noPost: readBool('moonlitNoPost'),
        noMRT: readBool('moonlitNoMRT'),
        noCompute: readBool('moonlitNoCompute'),
        mrtAudit: readBool('moonlitMrtAudit'),
        debugLogs: readBool('moonlitDebug'),
        baseline: readBool('moonlitBaseline'),
        seed,
        fixedDtMs: Number.isFinite(fixedDtMs) && fixedDtMs > 0 ? fixedDtMs : null,
        playback: playbackSequence,
        playbackLoops,
        usePost: false,
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

const BASELINE_PRESET_ORDER = ['Minimal', 'Low', 'Medium', 'High', 'Ultra', 'Extreme'];

function stableSerialize(value) {
    if (Array.isArray(value)) {
        return `[${value.map((entry) => stableSerialize(entry)).join(',')}]`;
    }
    if (value && typeof value === 'object') {
        const keys = Object.keys(value).sort();
        return `{${keys.map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

function hashStringFNV1a(input) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < input.length; i += 1) {
        hash ^= input.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Moonlit Forest Theme
 * Features:
 * - Procedurally generated trees with parallax layers
 * - Glowing mushrooms
 * - Moonbeams
 * - Wildlife (glowing eyes, flying owl)
 * - Falling leaves
 */
export default class MoonlitForestTheme extends BaseTheme {
    constructor() {
        super('moonlit-forest');

        this.flags = parseMoonlitFlags();
        this.randomFn = createSeededRandom(this.flags.seed);
        this.fixedDeltaSeconds = this.flags.fixedDtMs ? this.flags.fixedDtMs / 1000 : null;
        this.fixedElapsedTime = 0;
        this.baselineFrames = [];
        this.baselineRenderStats = [];
        this.baselineMaxFrames = 5400;
        this.baselineTimeouts = new Set();
        this.baselineSequenceStats = {
            sequence: null,
            loops: 0,
            startedAt: 0,
        };
        this.lastBaselineSoakReport = null;
        this.lastBaselineResizeReport = null;
        this.lastBaselineSoakCampaign = null;
        this.lastBaselineCapture = null;
        this.lastBaselineEvidence = null;
        this.lastBaselinePresetSweep = null;
        this.lastBaselineAnchorPack = null;
        this.lastBaselineHeroFrameReport = null;
        this.baselineEventCounts = {
            lineClear: 0,
            combo: 0,
            pieceLock: 0,
        };
        this.lastBaselineEventDirectives = {
            lineClear: null,
            combo: null,
            pieceLock: null,
        };
        this.activeQualityLevel = 'high';
        this.qualityCheckAccumulator = 0;
        this.qualityTransitionInProgress = false;

        // Renderer state (hybrid WebGPU/WebGL2 path)
        this.renderer = null;
        this.scene = null;
        this.camera = null;
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
        this.postProcessing = null;
        this.forceWebGL = false; // Backward compatibility override
        this.boundResizeHandler = this.onResize.bind(this);
        this.timeoutIds = new Set();
        this.webglContextLostHandler = null;
        this.webglContextRestoredHandler = null;
        this.deviceLossRecoveryInProgress = false;
        this.deviceLossRecoveries = 0;
        this.renderFallbackInProgress = false;
        this.time = 0;
        this.lastFrameTime = 0;

        // Three.js scene elements
        this.skyMesh = null;
        this.starfield = null;
        this.moonMesh = null;
        this.moonHalo = null;
        this.moonLight = null;
        this.ambientLight = null;
        this.warmFillLight = null;
        this.forestGround = null;
        this.forestLayerRuntime = [];
        this.forestFogLayers = [];
        this.forestUndergrowthLayers = [];
        this.forestFramingSilhouettes = [];
        this.fogBasinLayers = [];
        this.tmpMatrix = new THREE.Matrix4();
        this.tmpQuaternion = new THREE.Quaternion();
        this.tmpPosition = new THREE.Vector3();
        this.tmpScale = new THREE.Vector3();
        this.tmpEuler = new THREE.Euler();
        this.tmpColor = new THREE.Color();
        this.skyUniforms = null;
        this.starUniforms = null;
        this.moonUniforms = null;
        this.moonHaloUniforms = null;

        this.eventUnsubscribers = [];
        this.currentComboLevel = 0;
        this.gpuMushrooms = [];
        this.gpuMoonbeams = [];
        this.gpuWildlifeEyes = [];
        this.gpuLeaves = [];
        this.particleSystem = null;
        this.qualityConfig = null;
        this.gpuBudget = null;
        this.adaptiveBudgetState = {
            frameTimeEMA: 16.7,
            qualityScale: 1,
            resolutionScale: 1,
            baseResolutionScale: 1,
            emissionScale: 1,
        };
        this.lastRendererWidth = 0;
        this.lastRendererHeight = 0;
        this.lastRendererPixelRatio = 0;
        this.lastAppliedResolutionScale = 1;
        this.lastAdaptiveApplyTime = 0;
        this.adaptiveApplyMinIntervalMs = 180;
        this.postSuppressedByBudget = false;
        this.lastPostToggleTime = 0;
        this.postToggleCooldownMs = 600;
        this.sceneMotionAccumulator = 0;
        this.particleUpdateAccumulator = 0;
        this.postUpdateAccumulator = 0;
        this.lastPostBloomStrength = null;
        this.lastPostExposure = null;
        this.lastPostSaturation = null;
        this.forestAtmospherePulse = 0;
        this.fxController = new MoonlitForestFXController();
    }

    async init() {
        // Theme resources are created on-demand in createScene()
    }

    random(min = 0, max = 1) {
        return this.randomFn() * (max - min) + min;
    }

    refreshRuntimeFlags() {
        const parsedFlags = parseMoonlitFlags();
        const previousFlags = this.flags || {};
        if (this.forceWebGL === true) {
            parsedFlags.forceWebGL = true;
        }

        // Keep runtime fallbacks sticky while the theme instance is active.
        parsedFlags.forceWebGL = parsedFlags.forceWebGL || previousFlags.forceWebGL === true;
        parsedFlags.noPost = parsedFlags.noPost || previousFlags.noPost === true;
        parsedFlags.noMRT = parsedFlags.noMRT || previousFlags.noMRT === true;
        parsedFlags.noCompute = parsedFlags.noCompute || previousFlags.noCompute === true;
        parsedFlags.debugLogs = parsedFlags.debugLogs || previousFlags.debugLogs === true;

        this.flags = parsedFlags;
        this.randomFn = createSeededRandom(this.flags.seed);
        this.fixedDeltaSeconds = this.flags.fixedDtMs ? this.flags.fixedDtMs / 1000 : null;
        this.fixedElapsedTime = 0;
    }

    getBackendLabel() {
        return this.isWebGPU ? 'WebGPU' : 'WebGL2';
    }

    shouldLogDiagnostics() {
        return this.flags?.debugLogs === true || this.flags?.baseline === true || this.flags?.mrtAudit === true;
    }

    debugLog(...args) {
        if (this.shouldLogDiagnostics()) {
            console.log(...args);
        }
    }

    trackBaselineFrame(deltaSeconds) {
        const frameMs = deltaSeconds * 1000;
        if (!Number.isFinite(frameMs) || frameMs <= 0) return;

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
        this.lastBaselineEventDirectives = {
            lineClear: null,
            combo: null,
            pieceLock: null,
        };
        this.lastBaselineSoakReport = null;
        this.lastBaselineResizeReport = null;
        this.lastBaselineSoakCampaign = null;
        this.lastBaselineCapture = null;
        this.lastBaselineEvidence = null;
        this.lastBaselinePresetSweep = null;
        this.lastBaselineAnchorPack = null;
        this.lastBaselineHeroFrameReport = null;
    }

    computeBaselineReport() {
        if (!this.baselineFrames.length) return null;

        const sortedFrames = [...this.baselineFrames].sort((a, b) => a - b);
        const frameCount = this.baselineFrames.length;
        const avgMs = this.baselineFrames.reduce((sum, value) => sum + value, 0) / frameCount;
        const avgFps = avgMs > 0 ? (1000 / avgMs) : 0;
        const varianceMs2 = this.baselineFrames.reduce((sum, frameMs) => {
            const diff = frameMs - avgMs;
            return sum + (diff * diff);
        }, 0) / frameCount;
        const stdDevMs = Math.sqrt(varianceMs2);
        const p99Index = Math.max(0, Math.floor(sortedFrames.length * 0.99) - 1);
        const p99Ms = sortedFrames[p99Index] ?? avgMs;
        const low1Fps = p99Ms > 0 ? (1000 / p99Ms) : 0;

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

        return {
            backend: this.getBackendLabel(),
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
            directives: {
                lineClear: this.lastBaselineEventDirectives.lineClear,
                combo: this.lastBaselineEventDirectives.combo,
                pieceLock: this.lastBaselineEventDirectives.pieceLock,
            },
        };
    }

    reportBaseline() {
        const report = this.computeBaselineReport();
        if (!report) {
            this.debugLog('[MoonlitBaseline] No frames collected yet.');
            return null;
        }
        this.debugLog('[MoonlitBaseline] Report:', report);
        return report;
    }

    captureBaseline(label = 'moonlit-forest') {
        const canvas = this.renderer?.domElement;
        if (!canvas || typeof canvas.toBlob !== 'function') {
            console.warn('[MoonlitBaseline] Capture skipped: renderer canvas does not support toBlob.');
            return Promise.resolve(null);
        }

        return new Promise((resolve) => {
            canvas.toBlob((blob) => {
                if (!blob) {
                    resolve(null);
                    return;
                }

                const capture = {
                    label,
                    backend: this.getBackendLabel(),
                    preset: this.activeQualityLevel,
                    timestamp: Date.now(),
                    sizeBytes: blob.size,
                    mimeType: blob.type,
                    blob,
                };
                this.lastBaselineCapture = capture;
                resolve(capture);
            }, 'image/png');
        });
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
        const schedule = typeof window !== 'undefined' && typeof window.setTimeout === 'function'
            ? window.setTimeout.bind(window)
            : setTimeout;
        const timeoutId = schedule(() => {
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

    normalizeBaselineQuality(level = 'High') {
        const key = String(level ?? '').trim().toLowerCase();
        const preset = BASELINE_PRESET_ORDER.find((candidate) => candidate.toLowerCase() === key);
        if (preset) return preset.toLowerCase();
        return 'high';
    }

    formatBaselineQuality(level = 'high') {
        const key = this.normalizeBaselineQuality(level);
        const preset = BASELINE_PRESET_ORDER.find((candidate) => candidate.toLowerCase() === key);
        return preset || 'High';
    }

    getBaselinePresetOrder() {
        return [...BASELINE_PRESET_ORDER];
    }

    async waitForQualityPreset(level, options = {}) {
        const target = this.normalizeBaselineQuality(level);
        const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
            ? options.timeoutMs
            : 12000;
        const pollMs = Number.isFinite(options.pollMs) && options.pollMs > 0
            ? options.pollMs
            : 120;
        const startedAt = Date.now();

        while (this.isActive && (Date.now() - startedAt) < timeoutMs) {
            if (this.activeQualityLevel === target && this.qualityTransitionInProgress === false) {
                return true;
            }
            await this.waitForBaseline(pollMs);
        }

        return this.activeQualityLevel === target && this.qualityTransitionInProgress === false;
    }

    async setBaselineQuality(level, options = {}) {
        if (!this.isActive) return false;

        const target = this.normalizeBaselineQuality(level);
        const settleMs = Number.isFinite(options.settleMs) && options.settleMs >= 0
            ? options.settleMs
            : 450;
        const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
            ? options.timeoutMs
            : 12000;
        const pollMs = Number.isFinite(options.pollMs) && options.pollMs > 0
            ? options.pollMs
            : 120;

        if (typeof window !== 'undefined') {
            const runtimeSettings = window.settings || {};
            runtimeSettings.effectQuality = this.formatBaselineQuality(target);
            window.settings = runtimeSettings;
        }

        if (this.activeQualityLevel !== target && this.qualityTransitionInProgress === false) {
            this.requestQualityTransition(target);
        }

        const settled = await this.waitForQualityPreset(target, { timeoutMs, pollMs });
        if (!settled) return false;

        if (settleMs > 0) {
            await this.waitForBaseline(settleMs);
        }

        return this.activeQualityLevel === target;
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
                { event: EVENTS.LINE_CLEAR, payload: { lineCount: 4 } },
                { event: EVENTS.COMBO, payload: { comboCount: 6 } },
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
        if (!this.isActive) return false;

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

        for (let loop = 0; loop < loops; loop += 1) {
            sequence.forEach((step, index) => {
                const delayMs = (loop * sequence.length + index) * stepMs;
                this.scheduleBaselineTimeout(() => {
                    if (!this.isActive) return;
                    const payload = step.payload && typeof step.payload === 'object'
                        ? { ...step.payload }
                        : step.payload;
                    eventBus.emit(step.event, payload);
                }, delayMs);
            });
        }

        this.scheduleBaselineTimeout(() => {}, this.getBaselineSequenceDurationMs(name, loops, stepMs));
        this.debugLog('[MoonlitBaseline] Playing sequence', { name, loops, stepMs });
        return true;
    }

    async runBaselineEventValidation(options = {}) {
        if (!this.isActive) {
            console.warn('[MoonlitBaseline] validateEvents skipped: theme is not active.');
            return null;
        }

        const settleMs = Number.isFinite(options.settleMs) && options.settleMs > 0 ? options.settleMs : 120;
        const runtimeSettings = typeof window !== 'undefined' ? (window.settings || {}) : {};
        const previousComboSetting = runtimeSettings.backgroundComboEffects;
        runtimeSettings.backgroundComboEffects = true;
        if (typeof window !== 'undefined') {
            window.settings = runtimeSettings;
        }

        const expectsAurora = this.qualityConfig?.comboEffects?.auroraEnabled === true;
        const checks = [
            {
                key: 'lineClear',
                event: EVENTS.LINE_CLEAR,
                payload: { lineCount: 4 },
                validateDirective: (directive) => directive?.mushroomIntensity === 4
                    && directive?.moonbeamIntensity === 4
                    && directive?.enchantedLeafCount >= 8,
            },
            {
                key: 'combo',
                event: EVENTS.COMBO,
                payload: { comboCount: 6 },
                validateDirective: (directive) => directive?.combo === 6
                    && directive?.wispCount >= 0
                    && directive?.enableAurora === expectsAurora,
            },
            {
                key: 'pieceLock',
                event: EVENTS.PIECE_LOCK,
                payload: {},
                validateDirective: (directive) => directive != null
                    && Number.isFinite(directive.sparkleCount)
                    && Number.isFinite(directive.mistCount),
            },
        ];

        const before = { ...this.baselineEventCounts };
        const results = [];

        try {
            // Ensure any prior decay does not leak into assertion snapshots.
            this.lastBaselineEventDirectives = {
                lineClear: null,
                combo: null,
                pieceLock: null,
            };

            // eslint-disable-next-line no-restricted-syntax
            for (const check of checks) {
                eventBus.emit(check.event, { ...check.payload });
                await this.waitForBaseline(settleMs);

                const afterCount = this.baselineEventCounts[check.key];
                const countDelta = afterCount - before[check.key];
                before[check.key] = afterCount;

                const directive = this.lastBaselineEventDirectives[check.key];
                const directivePass = check.validateDirective(directive);
                const pass = countDelta > 0 && directivePass;

                results.push({
                    key: check.key,
                    countDelta,
                    directivePass,
                    pass,
                });
            }
        } finally {
            runtimeSettings.backgroundComboEffects = previousComboSetting;
            if (typeof window !== 'undefined') {
                window.settings = runtimeSettings;
            }
        }

        const passed = results.every((result) => result.pass);
        const report = {
            passed,
            settleMs,
            quality: this.activeQualityLevel,
            backend: this.getBackendLabel(),
            results,
            counts: { ...this.baselineEventCounts },
        };
        this.debugLog('[MoonlitBaseline] Event validation:', report);
        return report;
    }

    async runBaselineResizeStress(options = {}) {
        if (!this.isActive) {
            console.warn('[MoonlitBaseline] runResizeStress skipped: theme is not active.');
            return null;
        }

        const cycles = Number.isFinite(options.cycles) && options.cycles > 0
            ? Math.floor(options.cycles)
            : 20;
        const settleMs = Number.isFinite(options.settleMs) && options.settleMs > 0
            ? options.settleMs
            : 260;
        const stepMs = Number.isFinite(options.stepMs) && options.stepMs > 0
            ? options.stepMs
            : 220;
        const samples = [];

        for (let cycle = 0; cycle < cycles; cycle += 1) {
            if (!this.isActive) break;

            this.playBaselineSequence('stress', { loops: 1, stepMs });
            await this.waitForBaseline(this.getBaselineSequenceDurationMs('stress', 1, stepMs) + settleMs);
            this.onResize();
            await this.waitForBaseline(settleMs);

            const report = this.computeBaselineReport();
            if (report) {
                samples.push({
                    cycle: cycle + 1,
                    avgFps: report.avgFps,
                    p99Ms: report.p99Ms,
                    heapUsedMb: report.heapUsedMb,
                    gpuMemoryEstimateMb: report.gpuMemoryEstimateMb,
                });
            }
        }

        const first = samples[0] || null;
        const last = samples[samples.length - 1] || null;
        const resizeReport = {
            backend: this.getBackendLabel(),
            quality: this.activeQualityLevel,
            cyclesRequested: cycles,
            cyclesCompleted: samples.length,
            samples,
            avgFpsDelta: first && last ? Number((last.avgFps - first.avgFps).toFixed(2)) : null,
            heapDeltaMb: first && last && first.heapUsedMb !== null && last.heapUsedMb !== null
                ? Number((last.heapUsedMb - first.heapUsedMb).toFixed(2))
                : null,
        };

        this.lastBaselineResizeReport = resizeReport;
        this.debugLog('[MoonlitBaseline] Resize stress report:', resizeReport);
        return resizeReport;
    }

    async runBaselineSoak(options = {}) {
        if (!this.isActive) {
            console.warn('[MoonlitBaseline] runSoak skipped: theme is not active.');
            return null;
        }

        const durationMinutes = Number.isFinite(options.durationMinutes) && options.durationMinutes > 0
            ? options.durationMinutes
            : 30;
        const sampleSeconds = Number.isFinite(options.sampleSeconds) && options.sampleSeconds > 0
            ? options.sampleSeconds
            : 30;
        const stepMs = Number.isFinite(options.stepMs) && options.stepMs > 0
            ? options.stepMs
            : 220;
        const settleMs = Number.isFinite(options.settleMs) && options.settleMs > 0
            ? options.settleMs
            : 250;
        const durationMs = durationMinutes * 60 * 1000;
        const sampleIntervalMs = sampleSeconds * 1000;
        const samples = [];
        const startedAt = Date.now();

        while (this.isActive && (Date.now() - startedAt) < durationMs) {
            this.playBaselineSequence('stress', { loops: 1, stepMs });
            const sequenceMs = this.getBaselineSequenceDurationMs('stress', 1, stepMs);
            const waitMs = Math.max(sampleIntervalMs, sequenceMs + settleMs);
            await this.waitForBaseline(waitMs);

            const report = this.computeBaselineReport();
            if (report) {
                samples.push({
                    elapsedMinutes: Number(((Date.now() - startedAt) / 60000).toFixed(2)),
                    avgFps: report.avgFps,
                    p99Ms: report.p99Ms,
                    heapUsedMb: report.heapUsedMb,
                    gpuMemoryEstimateMb: report.gpuMemoryEstimateMb,
                });
            }
        }

        const first = samples[0] || null;
        const last = samples[samples.length - 1] || null;
        const soakReport = {
            backend: this.getBackendLabel(),
            quality: this.activeQualityLevel,
            durationMinutes,
            sampleSeconds,
            sampleCount: samples.length,
            samples,
            avgFpsDelta: first && last ? Number((last.avgFps - first.avgFps).toFixed(2)) : null,
            heapDeltaMb: first && last && first.heapUsedMb !== null && last.heapUsedMb !== null
                ? Number((last.heapUsedMb - first.heapUsedMb).toFixed(2))
                : null,
            completed: !this.isActive ? false : (Date.now() - startedAt) >= durationMs,
        };

        this.lastBaselineSoakReport = soakReport;
        this.debugLog('[MoonlitBaseline] Soak report:', soakReport);
        return soakReport;
    }

    async runBaselineSoakCampaign(options = {}) {
        if (!this.isActive) {
            console.warn('[MoonlitBaseline] runSoakCampaign skipped: theme is not active.');
            return null;
        }

        const presets = Array.isArray(options.presets) && options.presets.length > 0
            ? options.presets
            : ['Medium', 'High', 'Ultra'];
        const warmupMs = Number.isFinite(options.warmupMs) && options.warmupMs > 0
            ? options.warmupMs
            : 1000;
        const qualityOptions = {
            settleMs: Number.isFinite(options.qualitySettleMs) && options.qualitySettleMs >= 0
                ? options.qualitySettleMs
                : 700,
            timeoutMs: Number.isFinite(options.qualityTimeoutMs) && options.qualityTimeoutMs > 0
                ? options.qualityTimeoutMs
                : 20000,
            pollMs: Number.isFinite(options.qualityPollMs) && options.qualityPollMs > 0
                ? options.qualityPollMs
                : 120,
        };
        const soakOptions = {
            durationMinutes: Number.isFinite(options.durationMinutes) && options.durationMinutes > 0
                ? options.durationMinutes
                : 30,
            sampleSeconds: Number.isFinite(options.sampleSeconds) && options.sampleSeconds > 0
                ? options.sampleSeconds
                : 30,
            stepMs: Number.isFinite(options.stepMs) && options.stepMs > 0
                ? options.stepMs
                : 220,
            settleMs: Number.isFinite(options.settleMs) && options.settleMs > 0
                ? options.settleMs
                : 250,
        };

        const runs = [];
        const startedAt = Date.now();
        for (let i = 0; i < presets.length; i += 1) {
            if (!this.isActive) break;

            const requestedPreset = presets[i];
            const switched = await this.setBaselineQuality(requestedPreset, qualityOptions);
            if (!switched) {
                runs.push({
                    preset: this.formatBaselineQuality(requestedPreset),
                    switched: false,
                    soak: null,
                });
                continue;
            }

            this.resetBaseline();
            await this.waitForBaseline(warmupMs);
            const soak = await this.runBaselineSoak(soakOptions);
            runs.push({
                preset: this.formatBaselineQuality(this.activeQualityLevel),
                switched: true,
                soak,
            });
        }

        const campaign = {
            backend: this.getBackendLabel(),
            requestedPresets: presets.map((preset) => this.formatBaselineQuality(preset)),
            runs,
            startedAt,
            completedAt: Date.now(),
            completed: runs.length === presets.length
                && runs.every((run) => run.switched === true && run.soak?.completed === true),
        };

        this.lastBaselineSoakCampaign = campaign;
        this.debugLog('[MoonlitBaseline] Soak campaign:', campaign);
        return campaign;
    }

    buildTetrominoSnapshot(config = this.getTetrominoConfig()) {
        const serialized = stableSerialize(config);
        return {
            version: config?.version ?? null,
            renderMode: config?.renderMode ?? null,
            colors: { ...(config?.colors || {}) },
            effects: { ...(config?.effects || {}) },
            rendererOverrides: {
                canvas: { ...(config?.rendererOverrides?.canvas || {}) },
                phaser: { ...(config?.rendererOverrides?.phaser || {}) },
            },
            hash: hashStringFNV1a(serialized),
            serializedLength: serialized.length,
        };
    }

    getBaselineTetrominoSnapshot() {
        return this.buildTetrominoSnapshot(MOONLIT_FOREST_TETROMINOS);
    }

    validateTetrominoStyling(options = {}) {
        const activeSnapshot = this.buildTetrominoSnapshot(this.getTetrominoConfig());
        const baselineSnapshot = this.getBaselineTetrominoSnapshot();
        const expectedHash = typeof options.expectedHash === 'string' && options.expectedHash.length > 0
            ? options.expectedHash
            : baselineSnapshot.hash;
        const expectedRenderMode = options.expectedRenderMode ?? baselineSnapshot.renderMode;

        const report = {
            pass: activeSnapshot.hash === expectedHash && activeSnapshot.renderMode === expectedRenderMode,
            expectedHash,
            activeHash: activeSnapshot.hash,
            expectedRenderMode,
            activeRenderMode: activeSnapshot.renderMode,
            colorKeys: Object.keys(activeSnapshot.colors).sort(),
            effectKeys: Object.keys(activeSnapshot.effects).sort(),
            snapshot: activeSnapshot,
            baseline: baselineSnapshot,
        };

        this.debugLog('[MoonlitBaseline] Tetromino styling validation:', report);
        return report;
    }

    runHeroFrameChecklist(options = {}) {
        const generatedAt = Date.now();
        if (!this.scene || !this.camera) {
            const unavailable = {
                backend: this.getBackendLabel(),
                quality: this.activeQualityLevel,
                generatedAt,
                pass: false,
                reason: 'scene-unavailable',
                gates: {},
                metrics: {},
                manualPrompts: [],
            };
            this.lastBaselineHeroFrameReport = unavailable;
            this.debugLog('[MoonlitBaseline] Hero frame checklist:', unavailable);
            return unavailable;
        }

        const thresholds = {
            moonUpperThirdMinY: Number.isFinite(options.moonUpperThirdMinY) ? options.moonUpperThirdMinY : 0.22,
            moonCorridorMinX: Number.isFinite(options.moonCorridorMinX) ? options.moonCorridorMinX : 0.18,
            cameraFovMin: Number.isFinite(options.cameraFovMin) ? options.cameraFovMin : 56,
            cameraFovMax: Number.isFinite(options.cameraFovMax) ? options.cameraFovMax : 60,
            cameraYMin: Number.isFinite(options.cameraYMin) ? options.cameraYMin : 30,
            cameraYMax: Number.isFinite(options.cameraYMax) ? options.cameraYMax : 40,
            cameraZMin: Number.isFinite(options.cameraZMin) ? options.cameraZMin : 160,
            cameraZMax: Number.isFinite(options.cameraZMax) ? options.cameraZMax : 220,
            cameraTargetDotMin: Number.isFinite(options.cameraTargetDotMin) ? options.cameraTargetDotMin : 0.985,
            minFramingPerSide: Number.isFinite(options.minFramingPerSide) ? options.minFramingPerSide : 1,
            minFogBasinLayers: Number.isFinite(options.minFogBasinLayers) ? options.minFogBasinLayers : 1,
            minFogSheets: Number.isFinite(options.minFogSheets) ? options.minFogSheets : 2,
            minUndergrowthInstances: Number.isFinite(options.minUndergrowthInstances) ? options.minUndergrowthInstances : 24,
        };

        const depthTiers = { back: 0, mid: 0, front: 0 };
        this.forestLayerRuntime.forEach((layer) => {
            const id = layer?.id;
            if (id === 'back' || id === 'mid' || id === 'front') {
                depthTiers[id] = layer?.instances?.length ?? 0;
            }
        });

        const undergrowthInstances = this.forestUndergrowthLayers.reduce(
            (sum, layer) => sum + (layer?.instances?.length ?? 0),
            0,
        );

        const leftFramingCount = this.forestFramingSilhouettes.reduce(
            (sum, silhouette) => sum + (((silhouette?.baseX ?? silhouette?.group?.position?.x ?? 0) < 0) ? 1 : 0),
            0,
        );
        const rightFramingCount = this.forestFramingSilhouettes.reduce(
            (sum, silhouette) => sum + (((silhouette?.baseX ?? silhouette?.group?.position?.x ?? 0) > 0) ? 1 : 0),
            0,
        );

        const lookTarget = new THREE.Vector3(0, 20, -700);
        const cameraDirection = new THREE.Vector3();
        this.camera.getWorldDirection(cameraDirection);
        const expectedDirection = lookTarget.sub(this.camera.position).normalize();
        const cameraTargetDot = THREE.MathUtils.clamp(cameraDirection.dot(expectedDirection), -1, 1);

        const moonNdc = { x: null, y: null, z: null };
        if (this.moonMesh) {
            const moonWorld = this.moonMesh.getWorldPosition(new THREE.Vector3());
            const projected = moonWorld.project(this.camera);
            moonNdc.x = Number(projected.x.toFixed(4));
            moonNdc.y = Number(projected.y.toFixed(4));
            moonNdc.z = Number(projected.z.toFixed(4));
        }

        const moonInFrame = moonNdc.x !== null && moonNdc.y !== null
            && moonNdc.x >= -1 && moonNdc.x <= 1
            && moonNdc.y >= -1 && moonNdc.y <= 1;
        const moonUpperThird = moonNdc.y !== null && moonNdc.y >= thresholds.moonUpperThirdMinY;
        const moonCorridor = moonNdc.x !== null && moonNdc.x >= thresholds.moonCorridorMinX;

        const gates = {
            cameraSpec: this.camera.fov >= thresholds.cameraFovMin
                && this.camera.fov <= thresholds.cameraFovMax
                && this.camera.position.y >= thresholds.cameraYMin
                && this.camera.position.y <= thresholds.cameraYMax
                && this.camera.position.z >= thresholds.cameraZMin
                && this.camera.position.z <= thresholds.cameraZMax
                && cameraTargetDot >= thresholds.cameraTargetDotMin,
            moonInFrame,
            moonUpperThird,
            moonCorridor,
            depthTierCoverage: depthTiers.back > 0 && depthTiers.mid > 0 && depthTiers.front > 0,
            framingCoverage: leftFramingCount >= thresholds.minFramingPerSide
                && rightFramingCount >= thresholds.minFramingPerSide,
            fogBasinCoverage: this.fogBasinLayers.length >= thresholds.minFogBasinLayers
                && this.forestFogLayers.length >= thresholds.minFogSheets,
            undergrowthCoverage: undergrowthInstances >= thresholds.minUndergrowthInstances,
            heroPropCoverage: this.gpuMushrooms.length > 0
                && this.gpuMoonbeams.length > 0
                && this.gpuWildlifeEyes.length > 0,
        };

        const report = {
            backend: this.getBackendLabel(),
            quality: this.activeQualityLevel,
            generatedAt,
            pass: Object.values(gates).every((value) => value === true),
            gates,
            metrics: {
                camera: {
                    fov: Number(this.camera.fov.toFixed(3)),
                    position: {
                        x: Number(this.camera.position.x.toFixed(3)),
                        y: Number(this.camera.position.y.toFixed(3)),
                        z: Number(this.camera.position.z.toFixed(3)),
                    },
                    targetAlignment: Number(cameraTargetDot.toFixed(4)),
                },
                moonNdc,
                depthTiers,
                framing: {
                    left: leftFramingCount,
                    right: rightFramingCount,
                    total: this.forestFramingSilhouettes.length,
                },
                fog: {
                    basinLayers: this.fogBasinLayers.length,
                    fogSheets: this.forestFogLayers.length,
                },
                undergrowthInstances,
                heroProps: {
                    mushrooms: this.gpuMushrooms.length,
                    moonbeams: this.gpuMoonbeams.length,
                    wildlifeEyes: this.gpuWildlifeEyes.length,
                    leaves: this.gpuLeaves.length,
                },
                starCount: this.starfield?.geometry?.getAttribute?.('position')?.count ?? 0,
            },
            manualPrompts: [
                'Moonlit atmosphere reads immediately (cool key light, no daylight green cast).',
                'Foreground silhouettes frame the moon corridor without board obstruction.',
                'Mid-ground fog basin stays as focal pocket and supports depth.',
                'Bioluminescent accents remain controlled and event-driven.',
                'Fallback path preserves composition and readability.',
            ],
        };

        this.lastBaselineHeroFrameReport = report;
        this.debugLog('[MoonlitBaseline] Hero frame checklist:', report);
        return report;
    }

    async captureBaselineEventAnchors(options = {}) {
        if (!this.isActive) {
            console.warn('[MoonlitBaseline] captureEventAnchors skipped: theme is not active.');
            return null;
        }

        const label = options.label || 'moonlit-phase0-anchors';
        const settleMsDefault = Number.isFinite(options.settleMs) && options.settleMs > 0
            ? options.settleMs
            : 260;
        const includeCapture = options.includeCapture !== false;
        const includeMetrics = options.includeMetrics !== false;
        const includeHeroFrameValidation = options.includeHeroFrameValidation !== false;
        const anchors = Array.isArray(options.anchors) && options.anchors.length > 0
            ? options.anchors
            : [
                {
                    id: 'idle', event: null, payload: null, settleMs: settleMsDefault,
                },
                {
                    id: 'line-clear-4', event: EVENTS.LINE_CLEAR, payload: { lineCount: 4 }, settleMs: settleMsDefault,
                },
                {
                    id: 'combo-6', event: EVENTS.COMBO, payload: { comboCount: 6 }, settleMs: settleMsDefault,
                },
                {
                    id: 'piece-lock', event: EVENTS.PIECE_LOCK, payload: {}, settleMs: settleMsDefault,
                },
            ];

        const runtimeSettings = typeof window !== 'undefined' ? (window.settings || {}) : {};
        const previousComboSetting = runtimeSettings.backgroundComboEffects;
        runtimeSettings.backgroundComboEffects = true;
        if (typeof window !== 'undefined') {
            window.settings = runtimeSettings;
        }

        const directiveByEvent = {
            [EVENTS.LINE_CLEAR]: 'lineClear',
            [EVENTS.COMBO]: 'combo',
            [EVENTS.PIECE_LOCK]: 'pieceLock',
        };
        const samples = [];
        const startedAt = Date.now();

        try {
            // eslint-disable-next-line no-restricted-syntax
            for (const anchor of anchors) {
                const settleMs = Number.isFinite(anchor?.settleMs) && anchor.settleMs > 0
                    ? anchor.settleMs
                    : settleMsDefault;
                const payload = anchor?.payload && typeof anchor.payload === 'object'
                    ? { ...anchor.payload }
                    : anchor?.payload;

                if (anchor?.event) {
                    eventBus.emit(anchor.event, payload || {});
                }
                await this.waitForBaseline(settleMs);

                const capture = includeCapture
                    ? await this.captureBaseline(`${label}-${anchor.id || 'anchor'}`)
                    : null;
                const directiveKey = anchor?.event ? directiveByEvent[anchor.event] : null;
                samples.push({
                    id: anchor?.id || 'anchor',
                    event: anchor?.event || null,
                    payload: payload ?? null,
                    settleMs,
                    directiveKey,
                    directive: directiveKey ? this.lastBaselineEventDirectives[directiveKey] : null,
                    metrics: includeMetrics ? this.computeBaselineReport() : null,
                    capture: capture
                        ? {
                            label: capture.label,
                            backend: capture.backend,
                            preset: capture.preset,
                            timestamp: capture.timestamp,
                            sizeBytes: capture.sizeBytes,
                            mimeType: capture.mimeType,
                        }
                        : null,
                });
            }
        } finally {
            runtimeSettings.backgroundComboEffects = previousComboSetting;
            if (typeof window !== 'undefined') {
                window.settings = runtimeSettings;
            }
        }

        const report = {
            label,
            generatedAt: Date.now(),
            startedAt,
            backend: this.getBackendLabel(),
            quality: this.activeQualityLevel,
            completed: samples.length === anchors.length,
            includes: {
                capture: includeCapture,
                metrics: includeMetrics,
                heroFrameValidation: includeHeroFrameValidation,
            },
            heroFrameValidation: includeHeroFrameValidation
                ? this.runHeroFrameChecklist(options.heroOptions || {})
                : null,
            anchors: samples,
        };

        this.lastBaselineAnchorPack = report;
        this.debugLog('[MoonlitBaseline] Event anchors:', report);
        return report;
    }

    async runBaselinePresetSweep(options = {}) {
        if (!this.isActive) {
            console.warn('[MoonlitBaseline] runPresetSweep skipped: theme is not active.');
            return null;
        }

        const presets = Array.isArray(options.presets) && options.presets.length > 0
            ? options.presets
            : this.getBaselinePresetOrder();
        const label = options.label || 'moonlit-phase0-preset-sweep';
        const includeCapture = options.includeCapture !== false;
        const includeEventValidation = options.includeEventValidation === true;
        const includeHeroFrameValidation = options.includeHeroFrameValidation !== false;
        const warmupMs = Number.isFinite(options.warmupMs) && options.warmupMs >= 0
            ? options.warmupMs
            : 900;
        const settleMs = Number.isFinite(options.settleMs) && options.settleMs > 0
            ? options.settleMs
            : 260;
        const sequence = typeof options.sequence === 'string' && options.sequence.length > 0
            ? options.sequence
            : 'default';
        const loops = Number.isFinite(options.loops) && options.loops > 0 ? Math.floor(options.loops) : 1;
        const stepMs = Number.isFinite(options.stepMs) && options.stepMs > 0 ? options.stepMs : 260;
        const qualityOptions = {
            settleMs: Number.isFinite(options.qualitySettleMs) && options.qualitySettleMs >= 0
                ? options.qualitySettleMs
                : 700,
            timeoutMs: Number.isFinite(options.qualityTimeoutMs) && options.qualityTimeoutMs > 0
                ? options.qualityTimeoutMs
                : 20000,
            pollMs: Number.isFinite(options.qualityPollMs) && options.qualityPollMs > 0
                ? options.qualityPollMs
                : 120,
        };

        const runs = [];
        const startedAt = Date.now();
        for (let i = 0; i < presets.length; i += 1) {
            if (!this.isActive) break;

            const requestedPreset = presets[i];
            const switched = await this.setBaselineQuality(requestedPreset, qualityOptions);
            if (!switched) {
                runs.push({
                    preset: this.formatBaselineQuality(requestedPreset),
                    switched: false,
                    report: null,
                    eventValidation: null,
                    heroFrameValidation: null,
                    tetrominoValidation: null,
                    capture: null,
                });
                continue;
            }

            this.resetBaseline();
            if (warmupMs > 0) {
                await this.waitForBaseline(warmupMs);
            }

            if (sequence) {
                this.playBaselineSequence(sequence, { loops, stepMs });
                await this.waitForBaseline(this.getBaselineSequenceDurationMs(sequence, loops, stepMs) + settleMs);
            }

            const report = this.reportBaseline();
            const eventValidation = includeEventValidation
                ? await this.runBaselineEventValidation(options.eventOptions || {})
                : null;
            const heroFrameValidation = includeHeroFrameValidation
                ? this.runHeroFrameChecklist(options.heroOptions || {})
                : null;
            const tetrominoValidation = this.validateTetrominoStyling(options.tetrominoOptions || {});
            const capture = includeCapture
                ? await this.captureBaseline(
                    `${label}-${this.formatBaselineQuality(this.activeQualityLevel).toLowerCase()}`,
                )
                : null;

            runs.push({
                preset: this.formatBaselineQuality(this.activeQualityLevel),
                switched: true,
                report,
                eventValidation,
                heroFrameValidation,
                tetrominoValidation,
                capture: capture
                    ? {
                        label: capture.label,
                        backend: capture.backend,
                        preset: capture.preset,
                        timestamp: capture.timestamp,
                        sizeBytes: capture.sizeBytes,
                        mimeType: capture.mimeType,
                    }
                    : null,
            });
        }

        const switchedRuns = runs.filter((run) => run.switched === true);
        const sweep = {
            label,
            backend: this.getBackendLabel(),
            requestedPresets: presets.map((preset) => this.formatBaselineQuality(preset)),
            startedAt,
            completedAt: Date.now(),
            includes: {
                capture: includeCapture,
                eventValidation: includeEventValidation,
                heroFrameValidation: includeHeroFrameValidation,
            },
            runs,
            completed: runs.length === presets.length && runs.every((run) => run.switched === true),
            allTetrominoPass: switchedRuns.every((run) => run.tetrominoValidation?.pass === true),
            allEventValidationPass: includeEventValidation
                ? switchedRuns.every((run) => run.eventValidation?.passed === true)
                : null,
            allHeroFramePass: includeHeroFrameValidation
                ? switchedRuns.every((run) => run.heroFrameValidation?.pass === true)
                : null,
        };

        this.lastBaselinePresetSweep = sweep;
        this.debugLog('[MoonlitBaseline] Preset sweep:', sweep);
        return sweep;
    }

    async collectBaselineEvidence(options = {}) {
        if (!this.isActive) {
            console.warn('[MoonlitBaseline] collectEvidence skipped: theme is not active.');
            return null;
        }

        const includeEventValidation = options.includeEventValidation !== false;
        const includeHeroFrameValidation = options.includeHeroFrameValidation !== false;
        const includeResizeStress = options.includeResizeStress === true;
        const includeSoak = options.includeSoak === true;
        const includeSoakCampaign = options.includeSoakCampaign === true;
        const includeAnchorCapture = options.includeAnchorCapture === true;
        const includePresetSweep = options.includePresetSweep === true;
        const includeCapture = options.includeCapture === true;

        const eventOptions = options.eventOptions || {};
        const heroOptions = options.heroOptions || {};
        const resizeOptions = options.resizeOptions || {};
        const soakOptions = options.soakOptions || {};
        const campaignOptions = options.campaignOptions || {};
        const anchorOptions = options.anchorOptions || {};
        const presetSweepOptions = options.presetSweepOptions || {};

        const evidence = {
            label: options.label || 'moonlit-phase8-evidence',
            generatedAt: Date.now(),
            backend: this.getBackendLabel(),
            quality: this.activeQualityLevel,
            capabilities: { ...this.capabilities },
            flags: { ...this.flags },
            report: this.reportBaseline(),
            tetrominoValidation: this.validateTetrominoStyling(options.tetrominoOptions || {}),
            eventValidation: null,
            heroFrameValidation: includeHeroFrameValidation
                ? this.runHeroFrameChecklist(heroOptions)
                : null,
            resizeStress: null,
            soak: null,
            soakCampaign: null,
            anchorCapture: null,
            presetSweep: null,
            capture: null,
        };

        if (includeEventValidation) {
            evidence.eventValidation = await this.runBaselineEventValidation(eventOptions);
        }
        if (includeResizeStress) {
            evidence.resizeStress = await this.runBaselineResizeStress(resizeOptions);
        }
        if (includeSoak) {
            evidence.soak = await this.runBaselineSoak(soakOptions);
        }
        if (includeSoakCampaign) {
            evidence.soakCampaign = await this.runBaselineSoakCampaign(campaignOptions);
        }
        if (includeAnchorCapture) {
            evidence.anchorCapture = await this.captureBaselineEventAnchors(anchorOptions);
        }
        if (includePresetSweep) {
            evidence.presetSweep = await this.runBaselinePresetSweep(presetSweepOptions);
        }
        if (includeCapture) {
            const capture = await this.captureBaseline(options.captureLabel || options.label || 'moonlit-phase8');
            evidence.capture = capture
                ? {
                    label: capture.label,
                    backend: capture.backend,
                    preset: capture.preset,
                    timestamp: capture.timestamp,
                    sizeBytes: capture.sizeBytes,
                    mimeType: capture.mimeType,
                }
                : null;
        }

        this.lastBaselineEvidence = evidence;
        this.debugLog('[MoonlitBaseline] Evidence bundle:', evidence);
        return evidence;
    }

    installBaselineHelpers() {
        if (typeof window === 'undefined') return;
        window.moonlitBaseline = {
            report: () => this.reportBaseline(),
            reset: () => this.resetBaseline(),
            capture: (label) => this.captureBaseline(label),
            play: (sequence = 'default', options = {}) => this.playBaselineSequence(sequence, options),
            validateEvents: (options = {}) => this.runBaselineEventValidation(options),
            validateHeroFrame: (options = {}) => this.runHeroFrameChecklist(options),
            getSequenceDuration: (sequence = 'default', loops = 1, stepMs = 260) => (
                this.getBaselineSequenceDurationMs(sequence, loops, stepMs)
            ),
            getPresetOrder: () => this.getBaselinePresetOrder(),
            setQuality: (level, options = {}) => this.setBaselineQuality(level, options),
            waitForQuality: (level, options = {}) => this.waitForQualityPreset(level, options),
            runResizeStress: (options = {}) => this.runBaselineResizeStress(options),
            runSoak: (options = {}) => this.runBaselineSoak(options),
            runSoakCampaign: (options = {}) => this.runBaselineSoakCampaign(options),
            captureEventAnchors: (options = {}) => this.captureBaselineEventAnchors(options),
            runPresetSweep: (options = {}) => this.runBaselinePresetSweep(options),
            getTetrominoSnapshot: () => this.buildTetrominoSnapshot(this.getTetrominoConfig()),
            validateTetrominoStyling: (options = {}) => this.validateTetrominoStyling(options),
            collectEvidence: (options = {}) => this.collectBaselineEvidence(options),
            getSoakReport: () => this.lastBaselineSoakReport,
            getSoakCampaign: () => this.lastBaselineSoakCampaign,
            getResizeReport: () => this.lastBaselineResizeReport,
            getHeroFrameReport: () => this.lastBaselineHeroFrameReport,
            getAnchorReport: () => this.lastBaselineAnchorPack,
            getPresetSweep: () => this.lastBaselinePresetSweep,
            getEvidence: () => this.lastBaselineEvidence,
            getEventCounts: () => ({ ...this.baselineEventCounts }),
            stop: () => this.clearBaselinePlaybackTimers(),
        };
        this.debugLog(
            '[MoonlitBaseline] Helpers: window.moonlitBaseline.report(), play(), validateEvents(),'
            + ' validateHeroFrame(), captureEventAnchors(), runPresetSweep(), setQuality(),'
            + ' runResizeStress(), runSoak(), runSoakCampaign(), collectEvidence(), stop()',
        );
    }

    removeBaselineHelpers() {
        if (typeof window !== 'undefined' && window.moonlitBaseline) {
            delete window.moonlitBaseline;
        }
    }

    setManagedTimeout(callback, delayMs) {
        const timeoutId = setTimeout(() => {
            this.timeoutIds.delete(timeoutId);
            callback();
        }, delayMs);
        this.timeoutIds.add(timeoutId);
        return timeoutId;
    }

    clearManagedTimeouts() {
        this.timeoutIds.forEach((timeoutId) => clearTimeout(timeoutId));
        this.timeoutIds.clear();
    }

    cancelAnimationLoop() {
        if (this.animationIds?.length) {
            this.animationIds.forEach((id) => cancelAnimationFrame(id));
            this.animationIds = [];
        }
    }

    clearEventSubscriptions() {
        this.eventUnsubscribers.forEach((unsub) => unsub?.());
        this.eventUnsubscribers = [];
    }

    removeResizeListener() {
        if (typeof window !== 'undefined' && this.boundResizeHandler) {
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
            this.renderer.domElement.removeEventListener('webglcontextrestored', this.webglContextRestoredHandler, false);
            this.webglContextRestoredHandler = null;
        }
    }

    /**
     * Get quality setting from game settings
     */
    getQualitySetting() {
        if (typeof window !== 'undefined' && window.settings) {
            const quality = window.settings.effectQuality || 'High';
            return quality.toLowerCase();
        }
        return 'high';
    }

    /**
     * Get quality-specific configuration for Moonlit Forest
     * Balanced presets from Minimal to Extreme for optimal visual quality and performance
     */
    getQualityConfig(quality) {
        const configs = {
            minimal: {
                trees: { back: 5, mid: 4, front: 3 }, // Sparse forest
                leaves: 5, // Minimal falling leaves
                mushrooms: 5, // Few mushrooms
                moonbeams: 2, // Just a couple of beams
                eyes: 1, // Single glowing eyes
                fireflies: 3, // Very few ambient fireflies
                comboEffects: {
                    fireflyMultiplier: 0.2, // Minimal combo effects
                    sporesMultiplier: 0.2,
                    wispsMultiplier: 0, // No wisps
                    auroraEnabled: false, // No aurora
                    shootingStarsEnabled: false, // No shooting stars
                },
            },
            low: {
                trees: { back: 10, mid: 8, front: 6 }, // Light forest
                leaves: 12,
                mushrooms: 10,
                moonbeams: 3,
                eyes: 2,
                fireflies: 8,
                comboEffects: {
                    fireflyMultiplier: 0.4,
                    sporesMultiplier: 0.4,
                    wispsMultiplier: 0.3, // Minimal wisps
                    auroraEnabled: false,
                    shootingStarsEnabled: false,
                },
            },
            medium: {
                trees: { back: 15, mid: 12, front: 8 }, // Balanced forest
                leaves: 25,
                mushrooms: 15,
                moonbeams: 5,
                eyes: 3,
                fireflies: 15,
                comboEffects: {
                    fireflyMultiplier: 0.65,
                    sporesMultiplier: 0.65,
                    wispsMultiplier: 0.65,
                    auroraEnabled: true, // Aurora enabled from medium
                    shootingStarsEnabled: false,
                },
            },
            high: {
                trees: { back: 20, mid: 16, front: 11 }, // Dense forest
                leaves: 40,
                mushrooms: 22,
                moonbeams: 7,
                eyes: 5,
                fireflies: 22,
                comboEffects: {
                    fireflyMultiplier: 0.85,
                    sporesMultiplier: 0.85,
                    wispsMultiplier: 0.85,
                    auroraEnabled: true,
                    shootingStarsEnabled: true, // Shooting stars from high
                },
            },
            ultra: {
                trees: { back: 24, mid: 18, front: 12 }, // Dense forest
                leaves: 48,
                mushrooms: 26,
                moonbeams: 8,
                eyes: 6,
                fireflies: 26,
                comboEffects: {
                    fireflyMultiplier: 1.1,
                    sporesMultiplier: 1.1,
                    wispsMultiplier: 1.1,
                    auroraEnabled: true,
                    shootingStarsEnabled: true,
                },
            },
            extreme: {
                trees: { back: 28, mid: 22, front: 15 }, // Dense forest (optimized)
                leaves: 55,
                mushrooms: 30,
                moonbeams: 10,
                eyes: 8,
                fireflies: 30,
                comboEffects: {
                    fireflyMultiplier: 1.5, // Maximum effects
                    sporesMultiplier: 1.5,
                    wispsMultiplier: 1.5,
                    auroraEnabled: true,
                    shootingStarsEnabled: true,
                },
            },
        };

        const postProfiles = {
            minimal: {
                enabled: false,
                useMRT: false,
                resolutionScale: 0.62,
                bloomStrength: 0.22,
                bloomRadius: 0.4,
                bloomThreshold: 0.22,
                bloomDownsample: 0.95,
                vignetteOffset: 1.22,
                vignetteDarkness: 0.1,
                exposure: 1.02,
                contrast: 1.04,
                saturation: 1.02,
                tintStrength: 0.04,
                grainStrength: 0.0018,
            },
            low: {
                enabled: false,
                useMRT: false,
                resolutionScale: 0.7,
                bloomStrength: 0.28,
                bloomRadius: 0.46,
                bloomThreshold: 0.2,
                bloomDownsample: 0.9,
                vignetteOffset: 1.2,
                vignetteDarkness: 0.12,
                exposure: 1.04,
                contrast: 1.05,
                saturation: 1.04,
                tintStrength: 0.06,
                grainStrength: 0.002,
            },
            medium: {
                enabled: true,
                useMRT: false,
                resolutionScale: 0.82,
                bloomStrength: 0.34,
                bloomRadius: 0.52,
                bloomThreshold: 0.18,
                bloomDownsample: 0.85,
                vignetteOffset: 1.18,
                vignetteDarkness: 0.14,
                exposure: 1.07,
                contrast: 1.06,
                saturation: 1.06,
                tintStrength: 0.08,
                grainStrength: 0.0022,
            },
            high: {
                enabled: true,
                useMRT: true,
                resolutionScale: 0.9,
                bloomStrength: 0.42,
                bloomRadius: 0.58,
                bloomThreshold: 0.15,
                bloomDownsample: 0.8,
                vignetteOffset: 1.16,
                vignetteDarkness: 0.15,
                exposure: 1.09,
                contrast: 1.07,
                saturation: 1.08,
                tintStrength: 0.09,
                grainStrength: 0.0024,
            },
            ultra: {
                enabled: true,
                useMRT: true,
                resolutionScale: 0.92,
                bloomStrength: 0.46,
                bloomRadius: 0.62,
                bloomThreshold: 0.14,
                bloomDownsample: 0.76,
                vignetteOffset: 1.14,
                vignetteDarkness: 0.15,
                exposure: 1.12,
                contrast: 1.08,
                saturation: 1.1,
                tintStrength: 0.1,
                grainStrength: 0.0026,
            },
            extreme: {
                enabled: true,
                useMRT: true,
                resolutionScale: 0.88,
                bloomStrength: 0.5,
                bloomRadius: 0.65,
                bloomThreshold: 0.13,
                bloomDownsample: 0.5,
                vignetteOffset: 1.12,
                vignetteDarkness: 0.14,
                exposure: 1.14,
                contrast: 1.08,
                saturation: 1.11,
                tintStrength: 0.1,
                grainStrength: 0.0028,
            },
        };

        const gpuBudgets = {
            minimal: {
                adaptiveEnabled: true,
                targetFrameMs: 19.5,
                adaptiveMinScale: 0.6,
                adaptiveMaxScale: 0.95,
                adaptiveDownRate: 0.045,
                adaptiveUpRate: 0.015,
                minResolutionScale: 0.5,
                maxResolutionScale: 0.75,
                postDisableScale: 0.68,
                minEmissionScale: 0.35,
            },
            low: {
                adaptiveEnabled: true,
                targetFrameMs: 18.5,
                adaptiveMinScale: 0.62,
                adaptiveMaxScale: 0.98,
                adaptiveDownRate: 0.042,
                adaptiveUpRate: 0.017,
                minResolutionScale: 0.54,
                maxResolutionScale: 0.84,
                postDisableScale: 0.64,
                minEmissionScale: 0.4,
            },
            medium: {
                adaptiveEnabled: true,
                targetFrameMs: 17.4,
                adaptiveMinScale: 0.65,
                adaptiveMaxScale: 1.0,
                adaptiveDownRate: 0.04,
                adaptiveUpRate: 0.02,
                minResolutionScale: 0.62,
                maxResolutionScale: 0.94,
                postDisableScale: 0.6,
                minEmissionScale: 0.45,
            },
            high: {
                adaptiveEnabled: true,
                targetFrameMs: 16.7,
                adaptiveMinScale: 0.68,
                adaptiveMaxScale: 1.0,
                adaptiveDownRate: 0.036,
                adaptiveUpRate: 0.022,
                minResolutionScale: 0.68,
                maxResolutionScale: 1.0,
                postDisableScale: 0.58,
                minEmissionScale: 0.5,
            },
            ultra: {
                adaptiveEnabled: true,
                targetFrameMs: 16.7,
                adaptiveMinScale: 0.7,
                adaptiveMaxScale: 1.0,
                adaptiveDownRate: 0.033,
                adaptiveUpRate: 0.024,
                minResolutionScale: 0.72,
                maxResolutionScale: 1.0,
                postDisableScale: 0.56,
                minEmissionScale: 0.52,
            },
            extreme: {
                adaptiveEnabled: true,
                targetFrameMs: 16.7,
                adaptiveMinScale: 0.72,
                adaptiveMaxScale: 1.0,
                adaptiveDownRate: 0.03,
                adaptiveUpRate: 0.025,
                minResolutionScale: 0.75,
                maxResolutionScale: 1.0,
                postDisableScale: 0.55,
                minEmissionScale: 0.55,
            },
        };

        Object.keys(configs).forEach((tier) => {
            configs[tier].post = postProfiles[tier];
            configs[tier].gpuBudget = gpuBudgets[tier];
        });

        return configs[quality] || configs.high;
    }

    resolveGpuBudget(config = this.qualityConfig) {
        const postConfig = config?.post ?? {};
        const budget = config?.gpuBudget ?? {};
        return {
            adaptiveEnabled: budget.adaptiveEnabled !== false,
            targetFrameMs: budget.targetFrameMs ?? 16.7,
            adaptiveMinScale: budget.adaptiveMinScale ?? 0.65,
            adaptiveMaxScale: budget.adaptiveMaxScale ?? 1.0,
            adaptiveDownRate: budget.adaptiveDownRate ?? 0.035,
            adaptiveUpRate: budget.adaptiveUpRate ?? 0.02,
            minResolutionScale: budget.minResolutionScale ?? 0.62,
            maxResolutionScale: budget.maxResolutionScale ?? 1.0,
            postDisableScale: budget.postDisableScale ?? 0.6,
            minEmissionScale: budget.minEmissionScale ?? 0.45,
            baseResolutionScale: postConfig.resolutionScale ?? 1.0,
        };
    }

    initializeAdaptiveBudgetState() {
        this.gpuBudget = this.resolveGpuBudget(this.qualityConfig);
        const baseResolutionScale = THREE.MathUtils.clamp(this.gpuBudget.baseResolutionScale, 0.45, 1.0);
        this.adaptiveBudgetState = {
            frameTimeEMA: this.gpuBudget.targetFrameMs,
            qualityScale: 1,
            resolutionScale: baseResolutionScale,
            baseResolutionScale,
            emissionScale: 1,
        };
        this.lastRendererWidth = 0;
        this.lastRendererHeight = 0;
        this.lastRendererPixelRatio = 0;
        this.lastAppliedResolutionScale = baseResolutionScale;
        this.lastAdaptiveApplyTime = 0;
        this.postSuppressedByBudget = false;
        this.lastPostToggleTime = 0;
        this.sceneMotionAccumulator = 0;
        this.particleUpdateAccumulator = 0;
        this.postUpdateAccumulator = 0;
        this.lastPostBloomStrength = null;
        this.lastPostExposure = null;
        this.lastPostSaturation = null;
    }

    getRendererPixelRatio(maxRatio = 1.5) {
        const baseRatio = this.getEffectivePixelRatio(maxRatio);
        const resolutionScale = this.adaptiveBudgetState?.resolutionScale ?? 1;
        return Math.max(0.35, Math.min(maxRatio, baseRatio * resolutionScale));
    }

    scaleBurstCount(count) {
        if (!Number.isFinite(count) || count <= 0) return 0;
        const scale = this.adaptiveBudgetState?.emissionScale ?? 1;
        const scaled = Math.round(count * scale);
        return Math.max(0, scaled);
    }

    scaleBurstStrength(strength) {
        if (!Number.isFinite(strength) || strength <= 0) return 0;
        const scale = this.adaptiveBudgetState?.qualityScale ?? 1;
        return Math.max(0, strength * scale);
    }

    getSceneMotionStep() {
        const qualityScale = this.adaptiveBudgetState?.qualityScale ?? 1;
        if (qualityScale >= 0.92) return 1 / 60;
        if (qualityScale >= 0.84) return 1 / 48;
        if (qualityScale >= 0.76) return 1 / 40;
        return 1 / 32;
    }

    getParticleUpdateStep() {
        const qualityScale = this.adaptiveBudgetState?.qualityScale ?? 1;
        if (qualityScale >= 0.9) return 1 / 60;
        if (qualityScale >= 0.8) return 1 / 45;
        if (qualityScale >= 0.72) return 1 / 36;
        return 1 / 30;
    }

    maybeUpdateAdaptivePostState(
        nowMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()),
    ) {
        if (!this.postProcessing || !this.capabilities.post || this.flags.noPost) return;

        const budget = this.gpuBudget;
        const state = this.adaptiveBudgetState;
        if (!budget?.adaptiveEnabled || !state) return;

        if ((nowMs - this.lastPostToggleTime) < this.postToggleCooldownMs) return;

        const disableThreshold = THREE.MathUtils.clamp(budget.postDisableScale ?? 0.6, 0.35, 0.98);
        const enableThreshold = Math.min(1, disableThreshold + 0.08);

        if (!this.postSuppressedByBudget && this.flags.usePost && state.qualityScale <= disableThreshold) {
            this.flags.usePost = false;
            this.postSuppressedByBudget = true;
            this.lastPostToggleTime = nowMs;
            this.debugLog(
                `[MoonlitForest] Adaptive budget disabled post stack (qualityScale=${state.qualityScale.toFixed(2)})`,
            );
            return;
        }

        if (this.postSuppressedByBudget && this.capabilities.post && state.qualityScale >= enableThreshold) {
            this.flags.usePost = true;
            this.postSuppressedByBudget = false;
            this.lastPostToggleTime = nowMs;
            this.debugLog(
                `[MoonlitForest] Adaptive budget restored post stack (qualityScale=${state.qualityScale.toFixed(2)})`,
            );
        }
    }

    applyAdaptiveBudgetState(force = false) {
        if (!this.renderer || typeof window === 'undefined') return;

        const width = window.innerWidth;
        const height = window.innerHeight;

        const pixelRatio = this.getRendererPixelRatio(1.5);
        const resolutionScale = this.adaptiveBudgetState?.resolutionScale ?? 1;

        const sizeChanged = force || width !== this.lastRendererWidth || height !== this.lastRendererHeight;
        const pixelRatioChanged = force || Math.abs(pixelRatio - this.lastRendererPixelRatio) >= 0.02;
        const resolutionChanged = force || Math.abs(resolutionScale - this.lastAppliedResolutionScale) >= 0.01;

        if (pixelRatioChanged) {
            this.renderer.setPixelRatio(pixelRatio);
            this.lastRendererPixelRatio = pixelRatio;
        }

        if (sizeChanged || pixelRatioChanged) {
            this.renderer.setSize(width, height, false);
            this.postProcessing?.setSize?.(width, height);
            this.lastRendererWidth = width;
            this.lastRendererHeight = height;
        }

        if (resolutionChanged) {
            this.postProcessing?.update?.({ resolutionScale });
            this.lastAppliedResolutionScale = resolutionScale;
        }
    }

    updateAdaptiveBudgets(
        frameMs,
        nowMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()),
    ) {
        if (!Number.isFinite(frameMs) || frameMs <= 0) return;

        const budget = this.gpuBudget;
        const state = this.adaptiveBudgetState;
        if (!budget || !state) return;

        state.frameTimeEMA = (state.frameTimeEMA * 0.92) + (frameMs * 0.08);
        if (!budget.adaptiveEnabled) {
            this.maybeUpdateAdaptivePostState(nowMs);
            return;
        }

        const target = budget.targetFrameMs;
        let nextScale = state.qualityScale;
        if (state.frameTimeEMA > target * 1.08) {
            nextScale -= budget.adaptiveDownRate;
        } else if (state.frameTimeEMA < target * 0.88) {
            nextScale += budget.adaptiveUpRate;
        }

        nextScale = THREE.MathUtils.clamp(nextScale, budget.adaptiveMinScale, budget.adaptiveMaxScale);
        if (Math.abs(nextScale - state.qualityScale) < 0.01) {
            this.maybeUpdateAdaptivePostState(nowMs);
            return;
        }

        state.qualityScale = nextScale;
        state.resolutionScale = THREE.MathUtils.clamp(
            state.baseResolutionScale * nextScale,
            budget.minResolutionScale,
            budget.maxResolutionScale,
        );
        state.emissionScale = THREE.MathUtils.clamp(
            (nextScale - 0.25) / 0.75,
            budget.minEmissionScale,
            1.0,
        );

        const resolutionDelta = Math.abs(state.resolutionScale - this.lastAppliedResolutionScale);
        if (
            resolutionDelta >= 0.02
            && (nowMs - this.lastAdaptiveApplyTime) >= this.adaptiveApplyMinIntervalMs
        ) {
            this.applyAdaptiveBudgetState();
            this.lastAdaptiveApplyTime = nowMs;
        }
        this.maybeUpdateAdaptivePostState(nowMs);
    }

    requestQualityTransition(nextQuality) {
        if (!this.isActive || this.qualityTransitionInProgress) return;

        this.qualityTransitionInProgress = true;
        this.qualityCheckAccumulator = 0;
        this.debugLog(`[MoonlitForest] Quality transition requested (${this.activeQualityLevel} -> ${nextQuality})`);

        Promise.resolve()
            .then(() => this.createScene())
            .catch((error) => {
                console.error('[MoonlitForest] Quality transition failed:', error);
            })
            .finally(() => {
                this.qualityTransitionInProgress = false;
            });
    }

    maybeHandleQualityTransition(delta) {
        if (!Number.isFinite(delta) || delta <= 0) return false;
        if (this.qualityTransitionInProgress || !this.isActive) return false;

        this.qualityCheckAccumulator += delta;
        if (this.qualityCheckAccumulator < 0.75) return false;
        this.qualityCheckAccumulator = 0;

        const nextQuality = this.getQualitySetting();
        if (nextQuality === this.activeQualityLevel) return false;

        this.requestQualityTransition(nextQuality);
        return true;
    }

    shouldForceWebGL() {
        return this.flags.forceWebGL === true || this.forceWebGL === true;
    }

    async initRenderer(container) {
        if (!container || typeof window === 'undefined') return false;

        const width = window.innerWidth;
        const height = window.innerHeight;
        const forceWebGL = this.shouldForceWebGL();
        const preserveDrawingBuffer = this.flags.baseline === true;

        this.removeRendererResilienceListeners();

        let renderer = null;
        if (!forceWebGL) {
            try {
                renderer = new WEBGPU.WebGPURenderer({
                    antialias: this.getAntialiasEnabled(),
                    powerPreference: 'high-performance',
                    alpha: false,
                    forceWebGL: false,
                    preserveDrawingBuffer,
                });
                await renderer.init();
                if (renderer.backend?.isWebGPUBackend !== true) {
                    renderer.dispose();
                    renderer.forceContextLoss?.();
                    renderer.domElement?.remove?.();
                    renderer = null;
                }
            } catch (error) {
                console.warn('[MoonlitForest] WebGPU renderer init failed, using WebGL fallback:', error);
                renderer?.dispose?.();
                renderer?.forceContextLoss?.();
                renderer?.domElement?.remove?.();
                renderer = null;
            }
        }

        // Emergency fallback in case WebGPURenderer init fails unexpectedly.
        if (!renderer) {
            try {
                renderer = new THREE.WebGLRenderer({
                    antialias: this.getAntialiasEnabled(),
                    alpha: false,
                    powerPreference: 'high-performance',
                    preserveDrawingBuffer,
                });
            } catch (fallbackError) {
                console.error('[MoonlitForest] Unable to initialize any renderer backend:', fallbackError);
                return false;
            }
        }

        this.renderer = renderer;
        this.isWebGPU = renderer.backend?.isWebGPUBackend === true;
        this.isWebGL = renderer.isWebGLRenderer === true
            || renderer.backend?.isWebGLBackend === true
            || !this.isWebGPU;
        this.renderer.setClearColor(0x0c1826, 1);
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.0;
        this.renderer.sortObjects = true;
        this.renderer.autoClear = true;
        this.renderer.setPixelRatio(this.getRendererPixelRatio(1.5));
        this.renderer.setSize(width, height, false);
        this.renderer.domElement.id = 'moonlit-forest-renderer';
        this.renderer.domElement.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;z-index:1;pointer-events:none;';
        container.appendChild(this.renderer.domElement);

        this.setupRendererCapabilities();
        this.setupRendererResilience();

        if (this.flags.baseline) {
            this.debugLog('[MoonlitForest] Baseline mode enabled');
        }
        this.debugLog(`[MoonlitForest] Renderer initialized (${this.getBackendLabel()})`, {
            post: this.capabilities.post,
            mrt: this.capabilities.mrt,
            compute: this.capabilities.compute,
            maxColorAttachments: this.capabilities.maxColorAttachments,
        });
        return true;
    }

    setupRendererCapabilities() {
        const maxColorAttachments = this.renderer?.capabilities?.maxColorAttachments ?? 1;
        const supportsPost = true;
        const supportsMRT = this.isWebGPU && maxColorAttachments > 1;
        const supportsCompute = this.isWebGPU && typeof this.renderer?.compute === 'function';

        this.capabilities = {
            webgpu: this.isWebGPU,
            webgl: this.isWebGL,
            maxColorAttachments,
            supportsPost,
            supportsMRT,
            supportsCompute,
            post: !this.flags.noPost && supportsPost,
            mrt: !this.flags.noMRT && supportsMRT,
            compute: !this.flags.noCompute && supportsCompute,
        };

        this.flags.usePost = this.capabilities.post;
        this.flags.useMRT = this.capabilities.mrt;
        this.flags.useCompute = this.capabilities.compute;
    }

    setupRendererResilience() {
        if (!this.renderer?.domElement) return;

        this.removeRendererResilienceListeners();

        if (this.isWebGL) {
            this.webglContextLostHandler = (event) => {
                event.preventDefault();
                console.warn('[MoonlitForest] WebGL context lost');
            };
            this.webglContextRestoredHandler = () => {
                console.warn('[MoonlitForest] WebGL context restored');
                this.onResize();
            };
            this.renderer.domElement.addEventListener('webglcontextlost', this.webglContextLostHandler, false);
            this.renderer.domElement.addEventListener('webglcontextrestored', this.webglContextRestoredHandler, false);
        }

        this.renderer.onDeviceLost = (info) => {
            this.handleDeviceLoss(info);
        };

        const deviceLostPromise = this.renderer?.backend?.device?.lost;
        if (deviceLostPromise && typeof deviceLostPromise.then === 'function') {
            deviceLostPromise.then((info) => {
                this.handleDeviceLoss(info);
            }).catch(() => {
                // Intentionally ignore chained errors from lost device handling.
            });
        }
    }

    async requestWebGLFallback(reason = 'runtime-fallback', error = null) {
        if (this.renderFallbackInProgress || !this.isActive) return;
        if (this.shouldForceWebGL()) return;

        this.renderFallbackInProgress = true;
        console.warn(`[MoonlitForest] Switching to WebGL fallback (${reason})`, error || '');

        try {
            this.cancelAnimationLoop();
            this.clearEventSubscriptions();
            this.removeResizeListener();
            this.clearManagedTimeouts();
            this.cleanupRenderer();

            this.flags.forceWebGL = true;
            this.flags.noMRT = true;
            this.flags.noCompute = true;
            await this.createScene();
            this.debugLog('[MoonlitForest] WebGL fallback active after runtime recovery.');
        } catch (fallbackError) {
            console.error('[MoonlitForest] Runtime fallback failed:', fallbackError);
            this.isActive = false;
        } finally {
            this.renderFallbackInProgress = false;
        }
    }

    async handleDeviceLoss(info) {
        if (this.deviceLossRecoveryInProgress || !this.isActive) return;

        this.deviceLossRecoveryInProgress = true;
        this.deviceLossRecoveries += 1;
        console.error('[MoonlitForest] WebGPU device lost:', info);

        try {
            await this.requestWebGLFallback('device-loss', info);
        } finally {
            this.deviceLossRecoveryInProgress = false;
        }
    }

    setupPostProcessing() {
        this.postProcessing?.dispose?.();
        this.postProcessing = null;
        this.postSuppressedByBudget = false;
        this.lastPostToggleTime = 0;
        this.postUpdateAccumulator = 0;
        this.lastPostBloomStrength = null;
        this.lastPostExposure = null;
        this.lastPostSaturation = null;

        if (!this.renderer || !this.scene || !this.camera) {
            return;
        }

        const postConfig = this.qualityConfig?.post ?? {};
        const postEnabledByPreset = postConfig.enabled !== false;
        if (!this.flags.usePost || !postEnabledByPreset) {
            this.flags.usePost = false;
            return;
        }

        try {
            this.postProcessing = new MoonlitForestPost(this.renderer, this.scene, this.camera, {
                useMRT: this.flags.useMRT && postConfig.useMRT !== false,
                resolutionScale: this.adaptiveBudgetState?.resolutionScale ?? 1,
                bloomStrength: postConfig.bloomStrength ?? 0.35,
                bloomRadius: postConfig.bloomRadius ?? 0.55,
                bloomThreshold: postConfig.bloomThreshold ?? 0.2,
                bloomDownsample: postConfig.bloomDownsample ?? 0.8,
                vignetteOffset: postConfig.vignetteOffset ?? 1.08,
                vignetteDarkness: postConfig.vignetteDarkness ?? 0.3,
                exposure: postConfig.exposure ?? 1.03,
                contrast: postConfig.contrast ?? 1.045,
                saturation: postConfig.saturation ?? 1.05,
                tintStrength: postConfig.tintStrength ?? 0.11,
                grainStrength: postConfig.grainStrength ?? 0.0024,
            });
            this.postProcessing.setSize(window.innerWidth, window.innerHeight);
            if (this.flags.mrtAudit && this.flags.useMRT) {
                this.auditMrtMaterials();
            }
        } catch (error) {
            console.warn('[MoonlitForest] Post stack initialization failed, using direct render path:', error);
            this.postProcessing?.dispose?.();
            this.postProcessing = null;
            this.flags.usePost = false;
            this.capabilities.post = false;
        }
    }

    auditMrtMaterials() {
        if (!this.scene) return;

        let materialCount = 0;
        let emissiveMaterialCount = 0;
        let nonZeroEmissiveCount = 0;

        this.scene.traverse((object) => {
            if (!object.material) return;
            const materials = Array.isArray(object.material) ? object.material : [object.material];
            materials.forEach((material) => {
                if (!material) return;
                materialCount += 1;
                if (material.emissive?.isColor) {
                    emissiveMaterialCount += 1;
                    const intensity = Number.isFinite(material.emissiveIntensity)
                        ? material.emissiveIntensity
                        : (material.emissive.getHex() !== 0 ? 1 : 0);
                    if (intensity > 0 || material.emissive.getHex() !== 0) {
                        nonZeroEmissiveCount += 1;
                    }
                }
            });
        });

        this.debugLog('[MoonlitForest] MRT material audit', {
            backend: this.getBackendLabel(),
            useMRT: this.flags.useMRT,
            materialCount,
            emissiveMaterialCount,
            nonZeroEmissiveCount,
        });
    }

    createRendererScene() {
        if (!this.renderer || typeof window === 'undefined') return;

        const width = window.innerWidth;
        const height = window.innerHeight;

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x0c1826);
        this.scene.fog = new THREE.FogExp2(0x10202e, 0.00038);

        this.camera = new THREE.PerspectiveCamera(58, width / height, 0.1, 5000);
        this.camera.position.set(0, 34, 180);
        this.camera.lookAt(0, 20, -700);

        this.createSkyBackdrop();
        this.createForestGeometry();
        this.createGPUForestProps();
        this.createReactiveFXSystem();
        this.createStarfield();
        this.createMoon();
    }

    createSkyBackdrop() {
        if (!this.scene) return;

        const skyGeometry = new THREE.SphereGeometry(2600, 48, 32);
        let skyMaterial = null;

        if (this.isWebGPU) {
            const { material, uniforms } = createMoonlitSkyNodeMaterial({
                top: new THREE.Color(0x0a1628),
                mid: new THREE.Color(0x1a3050),
                bottom: new THREE.Color(0x0d1f35),
            });
            skyMaterial = material;
            this.skyUniforms = uniforms;
        } else {
            skyMaterial = new THREE.ShaderMaterial({
                uniforms: {
                    uTop: { value: new THREE.Color(0x0a1628) },
                    uMid: { value: new THREE.Color(0x1a3050) },
                    uBottom: { value: new THREE.Color(0x0d1f35) },
                    uTime: { value: 0 },
                },
                vertexShader: `
                    varying vec3 vWorldPosition;
                    void main() {
                        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
                        vWorldPosition = worldPosition.xyz;
                        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                    }
                `,
                fragmentShader: `
                    uniform vec3 uTop;
                    uniform vec3 uMid;
                    uniform vec3 uBottom;
                    uniform float uTime;
                    varying vec3 vWorldPosition;
                    void main() {
                        float h = normalize(vWorldPosition).y;
                        float skyBlend = smoothstep(-0.45, 0.75, h);
                        vec3 lowColor = mix(uBottom, uMid, smoothstep(-0.45, 0.25, h));
                        vec3 highColor = mix(uMid, uTop, smoothstep(0.1, 0.9, h));
                        float middleBand = smoothstep(-0.05, 0.35, h) * (1.0 - smoothstep(0.35, 0.85, h));
                        float shimmer = 0.97 + sin(uTime * 0.08 + h * 9.0) * 0.03;
                        vec3 color = mix(lowColor, highColor, skyBlend) + (uMid * middleBand * 0.08 * shimmer);
                        gl_FragColor = vec4(color, 1.0);
                    }
                `,
                side: THREE.BackSide,
                depthWrite: false,
            });
            this.skyUniforms = skyMaterial.uniforms;
        }

        this.skyMesh = new THREE.Mesh(skyGeometry, skyMaterial);
        this.skyMesh.position.set(0, 0, -900);
        this.scene.add(this.skyMesh);
    }

    createStarfield() {
        if (!this.scene) return;

        const starCount = Math.min(2400, 400 + ((this.qualityConfig?.moonbeams || 5) * 180));
        const positions = new Float32Array(starCount * 3);
        const colors = new Float32Array(starCount * 3);
        const sizes = new Float32Array(starCount);
        const phases = new Float32Array(starCount);
        const twinkles = new Float32Array(starCount);
        const color = new THREE.Color();

        for (let i = 0; i < starCount; i++) {
            const i3 = i * 3;
            const radius = 1200 + (this.random() * 1200);
            const theta = this.random() * Math.PI * 2;
            const phi = this.random() * Math.PI * 0.55;
            positions[i3] = Math.cos(theta) * Math.sin(phi) * radius;
            positions[i3 + 1] = Math.cos(phi) * radius + 120;
            positions[i3 + 2] = Math.sin(theta) * Math.sin(phi) * radius - 900;

            const hue = 0.55 + (this.random() * 0.08);
            const saturation = 0.08 + (this.random() * 0.25);
            const lightness = 0.65 + (this.random() * 0.25);
            color.setHSL(hue, saturation, lightness);
            colors[i3] = color.r;
            colors[i3 + 1] = color.g;
            colors[i3 + 2] = color.b;

            sizes[i] = 1.4 + (this.random() * 2.6);
            phases[i] = this.random() * Math.PI * 2;
            twinkles[i] = 0.6 + (this.random() * 1.8);
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
        geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
        geometry.setAttribute('aTwinkle', new THREE.BufferAttribute(twinkles, 1));

        let starMaterial = null;
        if (this.isWebGPU) {
            const { material, uniforms } = createMoonlitStarfieldNodeMaterial();
            starMaterial = material;
            this.starUniforms = uniforms;
        } else {
            starMaterial = new THREE.ShaderMaterial({
                uniforms: {
                    uTime: { value: 0 },
                },
                vertexShader: `
                    attribute float aSize;
                    attribute float aPhase;
                    attribute float aTwinkle;
                    uniform float uTime;
                    varying float vAlpha;
                    varying vec3 vColor;
                    void main() {
                        float twinkle = 0.5 + 0.5 * sin((uTime * aTwinkle) + aPhase);
                        vAlpha = twinkle * 0.55 + 0.18;
                        vColor = color * (0.75 + twinkle * 0.25);
                        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                        gl_PointSize = clamp(aSize * (180.0 / -mvPosition.z), 0.6, 8.0);
                        gl_Position = projectionMatrix * mvPosition;
                    }
                `,
                fragmentShader: `
                    varying float vAlpha;
                    varying vec3 vColor;
                    void main() {
                        vec2 centered = gl_PointCoord - vec2(0.5);
                        float dist = length(centered) * 2.0;
                        if (dist > 1.0) discard;
                        float softness = 1.0 - smoothstep(0.0, 1.0, dist);
                        gl_FragColor = vec4(vColor, vAlpha * softness);
                    }
                `,
                transparent: true,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
                vertexColors: true,
            });
            this.starUniforms = starMaterial.uniforms;
        }

        this.starfield = new THREE.Points(geometry, starMaterial);
        this.starfield.frustumCulled = false;
        this.scene.add(this.starfield);
    }

    createMoon() {
        if (!this.scene) return;

        const moonGeometry = new THREE.CircleGeometry(90, 72);
        const haloGeometry = new THREE.CircleGeometry(170, 72);
        let moonMaterial = null;
        let haloMaterial = null;

        if (this.isWebGPU) {
            const moonNode = createMoonlitMoonNodeMaterial({
                color: new THREE.Color(0xf4e8a8),
                glowIntensity: 0.58,
            });
            moonMaterial = moonNode.material;
            this.moonUniforms = moonNode.uniforms;

            const haloNode = createMoonlitMoonHaloNodeMaterial({
                color: new THREE.Color(0xd9eeff),
                opacity: 0.2,
            });
            haloMaterial = haloNode.material;
            this.moonHaloUniforms = haloNode.uniforms;
        } else {
            moonMaterial = new THREE.ShaderMaterial({
                uniforms: {
                    uColor: { value: new THREE.Color(0xf4e8a8) },
                    uTime: { value: 0 },
                },
                vertexShader: `
                    varying vec2 vUv;
                    void main() {
                        vUv = uv;
                        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                    }
                `,
                fragmentShader: `
                    uniform vec3 uColor;
                    uniform float uTime;
                    varying vec2 vUv;
                    void main() {
                        vec2 centeredUv = vUv - 0.5;
                        float dist = length(centeredUv) * 2.0;
                        float disc = smoothstep(1.0, 0.0, dist);
                        float craterWave = (sin(centeredUv.x * 32.0 + uTime * 0.09) * sin(centeredUv.y * 26.0 - uTime * 0.07)) * 0.5 + 0.5;
                        float craterMask = smoothstep(0.45, 0.95, craterWave);
                        vec3 craterTint = mix(vec3(1.0), vec3(0.82, 0.86, 0.92), craterMask * 0.5);
                        float edgeGlow = pow(1.0 - smoothstep(0.2, 1.0, dist), 2.0);
                        vec3 color = uColor * craterTint * (edgeGlow * 0.7 + 0.3);
                        gl_FragColor = vec4(color, disc);
                    }
                `,
                transparent: true,
                depthWrite: false,
            });
            this.moonUniforms = moonMaterial.uniforms;

            haloMaterial = new THREE.ShaderMaterial({
                uniforms: {
                    uColor: { value: new THREE.Color(0xd9eeff) },
                    uOpacity: { value: 0.2 },
                    uTime: { value: 0 },
                },
                vertexShader: `
                    varying vec2 vUv;
                    void main() {
                        vUv = uv;
                        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                    }
                `,
                fragmentShader: `
                    uniform vec3 uColor;
                    uniform float uOpacity;
                    uniform float uTime;
                    varying vec2 vUv;
                    void main() {
                        vec2 centeredUv = vUv - 0.5;
                        float dist = length(centeredUv) * 2.0;
                        float haloMask = pow(1.0 - smoothstep(0.0, 1.0, dist), 2.4);
                        float pulse = 0.92 + sin(uTime * 1.25) * 0.08;
                        float alpha = haloMask * uOpacity * pulse;
                        vec3 color = mix(uColor, vec3(0.95, 0.98, 1.0), smoothstep(0.5, 1.0, haloMask));
                        gl_FragColor = vec4(color, alpha);
                    }
                `,
                transparent: true,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
                side: THREE.DoubleSide,
            });
            this.moonHaloUniforms = haloMaterial.uniforms;
        }

        this.moonMesh = new THREE.Mesh(moonGeometry, moonMaterial);
        this.moonHalo = new THREE.Mesh(haloGeometry, haloMaterial);
        this.moonHalo.position.z = -2;
        this.scene.add(this.moonMesh);
        this.scene.add(this.moonHalo);
        this.updateMoonPosition();
    }

    createForestLights() {
        if (!this.scene) return;

        this.ambientLight = new THREE.AmbientLight(0x4a6880, 0.56);
        this.moonLight = new THREE.DirectionalLight(0xc8e4ff, 0.84);
        this.moonLight.position.set(220, 340, 120);
        this.moonLight.target.position.set(0, -20, -900);

        this.warmFillLight = new THREE.DirectionalLight(0xd4a574, 0.12);
        this.warmFillLight.position.set(-160, -40, 200);
        this.warmFillLight.target.position.set(0, -60, -700);

        this.scene.add(this.ambientLight);
        this.scene.add(this.moonLight);
        this.scene.add(this.moonLight.target);
        this.scene.add(this.warmFillLight);
        this.scene.add(this.warmFillLight.target);
    }

    createForestLayer(config) {
        if (!this.scene || config.count <= 0) return;

        const trunkGeometry = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
        const canopyGeometry = new THREE.ConeGeometry(1, 1, 7, 1, true);

        const trunkMaterial = new THREE.MeshStandardMaterial({
            color: config.trunkColor,
            roughness: 0.9,
            metalness: 0.04,
            flatShading: true,
            fog: true,
        });
        const canopyMaterial = new THREE.MeshStandardMaterial({
            color: config.canopyColor,
            roughness: 0.86,
            metalness: 0.02,
            flatShading: true,
            fog: true,
        });

        const trunkMesh = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, config.count);
        const canopyMesh = new THREE.InstancedMesh(canopyGeometry, canopyMaterial, config.count);
        trunkMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        canopyMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        trunkMesh.frustumCulled = false;
        canopyMesh.frustumCulled = false;

        const instances = [];
        for (let i = 0; i < config.count; i++) {
            const z = this.random(config.zMin, config.zMax);
            const x = this.random(-config.xSpan, config.xSpan);
            const y = config.yBase + this.random(-config.yJitter, config.yJitter);

            const trunkHeight = this.random(config.trunkHeight[0], config.trunkHeight[1]);
            const trunkRadius = this.random(config.trunkRadius[0], config.trunkRadius[1]);
            const canopyHeight = this.random(config.canopyHeight[0], config.canopyHeight[1]);
            const canopyRadius = this.random(config.canopyRadius[0], config.canopyRadius[1]);

            const yaw = this.random(0, Math.PI * 2);
            const phase = this.random(0, Math.PI * 2);
            const swaySpeed = this.random(config.swaySpeed[0], config.swaySpeed[1]);
            const swayAmplitude = this.random(config.swayAmplitude[0], config.swayAmplitude[1]);

            instances.push({
                x,
                y,
                z,
                trunkHeight,
                trunkRadius,
                canopyHeight,
                canopyRadius,
                yaw,
                phase,
                swaySpeed,
                swayAmplitude,
            });

            this.tmpEuler.set(0, yaw, 0);
            this.tmpQuaternion.setFromEuler(this.tmpEuler);
            this.tmpPosition.set(x, y + (trunkHeight * 0.5), z);
            this.tmpScale.set(trunkRadius, trunkHeight, trunkRadius);
            this.tmpMatrix.compose(this.tmpPosition, this.tmpQuaternion, this.tmpScale);
            trunkMesh.setMatrixAt(i, this.tmpMatrix);

            this.tmpPosition.set(x, y + trunkHeight + (canopyHeight * 0.45), z);
            this.tmpScale.set(canopyRadius, canopyHeight, canopyRadius);
            this.tmpMatrix.compose(this.tmpPosition, this.tmpQuaternion, this.tmpScale);
            canopyMesh.setMatrixAt(i, this.tmpMatrix);

            this.tmpColor.set(config.trunkColor).offsetHSL(
                this.random(-0.02, 0.02),
                this.random(-0.04, 0.04),
                this.random(-0.08, 0.08),
            );
            trunkMesh.setColorAt(i, this.tmpColor);

            this.tmpColor.set(config.canopyColor).offsetHSL(
                this.random(-0.03, 0.03),
                this.random(-0.09, 0.07),
                this.random(-0.1, 0.08),
            );
            canopyMesh.setColorAt(i, this.tmpColor);
        }

        this.scene.add(trunkMesh);
        this.scene.add(canopyMesh);

        this.forestLayerRuntime.push({
            id: config.id,
            trunkMesh,
            canopyMesh,
            instances,
            swayLeanFactor: config.swayLeanFactor,
        });
    }

    createForestFogLayers() {
        if (!this.scene) return;

        const fogGeometry = new THREE.PlaneGeometry(2000, 360, 1, 1);
        const fogPresets = [
            {
                y: -20, z: -540, opacity: 0.14, speed: 0.12, amplitude: 32, tint: 0x8cc6d8,
            },
            {
                y: -8, z: -760, opacity: 0.12, speed: 0.1, amplitude: 48, tint: 0x89c0d4,
            },
            {
                y: 12, z: -1010, opacity: 0.10, speed: 0.08, amplitude: 62, tint: 0x7ab3cc,
            },
        ];

        fogPresets.forEach((preset, index) => {
            const material = new THREE.MeshBasicMaterial({
                color: preset.tint,
                transparent: true,
                opacity: preset.opacity,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
                side: THREE.DoubleSide,
                fog: true,
            });
            const mesh = new THREE.Mesh(fogGeometry, material);
            mesh.position.set(0, preset.y, preset.z);
            mesh.rotation.x = -Math.PI / 2.35;
            mesh.scale.set(1 + (index * 0.15), 1, 1);

            this.scene.add(mesh);
            this.forestFogLayers.push({
                mesh,
                baseX: mesh.position.x,
                baseY: mesh.position.y,
                baseZ: mesh.position.z,
                baseOpacity: preset.opacity,
                speed: preset.speed,
                amplitude: preset.amplitude,
                phase: this.random(0, Math.PI * 2),
            });
        });
    }

    createForestUndergrowth() {
        if (!this.scene || !this.qualityConfig) return;

        const treeCounts = this.qualityConfig.trees ?? { back: 14, mid: 10, front: 7 };
        const targetCount = THREE.MathUtils.clamp(
            Math.floor((treeCounts.back + treeCounts.mid + treeCounts.front) * 3.4),
            36,
            280,
        );

        const undergrowthGeometry = new THREE.ConeGeometry(1, 1, 6, 1, true);
        const undergrowthMaterial = new THREE.MeshStandardMaterial({
            color: 0x294436,
            roughness: 0.93,
            metalness: 0.02,
            flatShading: true,
            fog: true,
            transparent: true,
            opacity: 0.82,
        });

        const mesh = new THREE.InstancedMesh(undergrowthGeometry, undergrowthMaterial, targetCount);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.frustumCulled = false;

        const instances = [];
        let attempts = 0;
        while (instances.length < targetCount && attempts < targetCount * 5) {
            attempts += 1;
            const x = this.random(-1040, 1040);
            const z = this.random(-1120, -420);

            // Keep the central mist pocket cleaner to preserve composition focal basin.
            const inFocalBasin = Math.abs(x) < 260 && z < -620 && z > -980;
            if (inFocalBasin && this.random() < 0.72) {
                continue;
            }

            instances.push({
                x,
                y: this.random(-98, -89),
                z,
                yaw: this.random(0, Math.PI * 2),
                radius: this.random(2.5, 7.5),
                height: this.random(14, 36),
                swayAmplitude: this.random(1.4, 4.2),
                swaySpeed: this.random(0.8, 1.6),
                phase: this.random(0, Math.PI * 2),
            });
        }

        for (let i = 0; i < targetCount; i++) {
            const instance = instances[i] ?? {
                x: this.random(-1040, 1040),
                y: this.random(-98, -89),
                z: this.random(-1120, -420),
                yaw: this.random(0, Math.PI * 2),
                radius: this.random(2.5, 7.5),
                height: this.random(14, 36),
                swayAmplitude: this.random(1.4, 4.2),
                swaySpeed: this.random(0.8, 1.6),
                phase: this.random(0, Math.PI * 2),
            };

            this.tmpEuler.set(0, instance.yaw, 0);
            this.tmpQuaternion.setFromEuler(this.tmpEuler);
            this.tmpPosition.set(instance.x, instance.y + (instance.height * 0.5), instance.z);
            this.tmpScale.set(instance.radius, instance.height, instance.radius);
            this.tmpMatrix.compose(this.tmpPosition, this.tmpQuaternion, this.tmpScale);
            mesh.setMatrixAt(i, this.tmpMatrix);
        }

        this.scene.add(mesh);
        this.forestUndergrowthLayers.push({
            mesh,
            instances: instances.slice(0, targetCount),
        });
    }

    createFramingSilhouettes() {
        if (!this.scene || !this.qualityConfig) return;

        const treeCounts = this.qualityConfig.trees ?? { back: 14, mid: 10, front: 7 };
        const silhouetteCount = THREE.MathUtils.clamp(
            Math.floor((treeCounts.front + treeCounts.mid) * 0.85),
            8,
            24,
        );

        const trunkGeometry = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
        const canopyGeometry = new THREE.ConeGeometry(1, 1, 8, 1, true);
        const trunkMaterial = new THREE.MeshStandardMaterial({
            color: 0x101a16,
            roughness: 0.96,
            metalness: 0.01,
            flatShading: true,
            fog: true,
        });
        const canopyMaterial = new THREE.MeshStandardMaterial({
            color: 0x14241d,
            roughness: 0.9,
            metalness: 0.01,
            flatShading: true,
            fog: true,
        });

        const addSilhouette = (side) => {
            for (let i = 0; i < silhouetteCount; i++) {
                const group = new THREE.Group();
                const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
                const canopy = new THREE.Mesh(canopyGeometry, canopyMaterial);

                const trunkHeight = this.random(132, 270);
                const trunkRadius = this.random(5, 10.5);
                const canopyHeight = this.random(170, 310);
                const canopyRadius = this.random(85, 160);

                trunk.position.y = trunkHeight * 0.5;
                trunk.scale.set(trunkRadius, trunkHeight, trunkRadius);
                canopy.position.y = trunkHeight + (canopyHeight * 0.45);
                canopy.scale.set(canopyRadius, canopyHeight, canopyRadius);

                group.add(trunk);
                group.add(canopy);

                const baseX = side * this.random(760, 1180);
                const baseY = this.random(-98, -90);
                const baseZ = this.random(-620, -230);
                group.position.set(baseX, baseY, baseZ);
                group.rotation.y = this.random(-0.22, 0.22) + (side > 0 ? -0.24 : 0.24);
                group.renderOrder = 6;

                this.scene.add(group);
                this.forestFramingSilhouettes.push({
                    group,
                    baseX,
                    baseY,
                    baseZ,
                    baseYaw: group.rotation.y,
                    swayAmplitude: this.random(2, 6.5),
                    swaySpeed: this.random(0.18, 0.32),
                    phase: this.random(0, Math.PI * 2),
                });
            }
        };

        addSilhouette(-1);
        addSilhouette(1);
    }

    createFogBasin() {
        if (!this.scene) return;

        const basinGeometry = new THREE.CircleGeometry(1, 64);
        const basinLayers = [
            {
                scaleX: 760,
                scaleY: 520,
                y: -70,
                z: -860,
                opacity: 0.22,
                color: 0x9bd0dc,
                speed: 0.11,
                drift: 10,
            },
            {
                scaleX: 520,
                scaleY: 360,
                y: -64,
                z: -780,
                opacity: 0.17,
                color: 0xb7dde8,
                speed: 0.16,
                drift: 7,
            },
            {
                scaleX: 340,
                scaleY: 250,
                y: -60,
                z: -720,
                opacity: 0.13,
                color: 0xd2edf6,
                speed: 0.2,
                drift: 5,
            },
        ];

        basinLayers.forEach((layer) => {
            const material = new THREE.MeshBasicMaterial({
                color: layer.color,
                transparent: true,
                opacity: layer.opacity,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
                fog: true,
            });
            const mesh = new THREE.Mesh(basinGeometry, material);
            mesh.rotation.x = -Math.PI / 2;
            mesh.position.set(0, layer.y, layer.z);
            mesh.scale.set(layer.scaleX, layer.scaleY, 1);
            mesh.renderOrder = 5;
            this.scene.add(mesh);

            this.fogBasinLayers.push({
                mesh,
                baseOpacity: layer.opacity,
                baseY: layer.y,
                baseZ: layer.z,
                speed: layer.speed,
                drift: layer.drift,
                phase: this.random(0, Math.PI * 2),
            });
        });
    }

    createForestGeometry() {
        if (!this.scene || !this.qualityConfig) return;

        this.forestLayerRuntime = [];
        this.forestFogLayers = [];
        this.forestUndergrowthLayers = [];
        this.forestFramingSilhouettes = [];
        this.fogBasinLayers = [];
        this.createForestLights();

        const groundGeometry = new THREE.CircleGeometry(2600, 64);
        const groundMaterial = new THREE.MeshStandardMaterial({
            color: 0x152420,
            roughness: 0.95,
            metalness: 0.03,
            fog: true,
        });
        this.forestGround = new THREE.Mesh(groundGeometry, groundMaterial);
        this.forestGround.rotation.x = -Math.PI / 2;
        this.forestGround.position.set(0, -95, -760);
        this.scene.add(this.forestGround);

        const treeCounts = this.qualityConfig?.trees ?? { back: 14, mid: 10, front: 7 };
        const layerConfigs = [
            {
                id: 'back',
                count: treeCounts.back,
                zMin: -1520,
                zMax: -1120,
                xSpan: 1200,
                yBase: -95,
                yJitter: 16,
                trunkHeight: [130, 240],
                trunkRadius: [2.8, 5.4],
                canopyHeight: [150, 260],
                canopyRadius: [44, 80],
                swaySpeed: [0.18, 0.28],
                swayAmplitude: [5.5, 9],
                swayLeanFactor: 0.015,
                trunkColor: 0x121e18,
                canopyColor: 0x182e25,
            },
            {
                id: 'mid',
                count: treeCounts.mid,
                zMin: -1120,
                zMax: -760,
                xSpan: 1020,
                yBase: -95,
                yJitter: 12,
                trunkHeight: [120, 220],
                trunkRadius: [3.3, 6.1],
                canopyHeight: [140, 230],
                canopyRadius: [55, 98],
                swaySpeed: [0.22, 0.34],
                swayAmplitude: [6.5, 10.5],
                swayLeanFactor: 0.018,
                trunkColor: 0x1c2e24,
                canopyColor: 0x2d5240,
            },
            {
                id: 'front',
                count: treeCounts.front,
                zMin: -760,
                zMax: -420,
                xSpan: 860,
                yBase: -95,
                yJitter: 10,
                trunkHeight: [110, 205],
                trunkRadius: [3.6, 6.8],
                canopyHeight: [130, 210],
                canopyRadius: [64, 112],
                swaySpeed: [0.26, 0.38],
                swayAmplitude: [8, 12.5],
                swayLeanFactor: 0.021,
                trunkColor: 0x223428,
                canopyColor: 0x3a7060,
            },
        ];

        layerConfigs.forEach((config) => this.createForestLayer(config));
        this.createForestUndergrowth();
        this.createFramingSilhouettes();
        this.createForestFogLayers();
        this.createFogBasin();
    }

    createMushroomProps() {
        if (!this.scene || !this.qualityConfig) return;

        this.gpuMushrooms = [];

        const stemGeometry = new THREE.CylinderGeometry(0.75, 0.95, 7.6, 6, 1);
        const capGeometry = new THREE.SphereGeometry(3.8, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.55);
        const glowGeometry = new THREE.SphereGeometry(6.2, 10, 8);

        const capPalette = [
            new THREE.Color(0x00d9ff),
            new THREE.Color(0xa78bfa),
            new THREE.Color(0x6ee7b7),
        ];

        const count = this.qualityConfig.mushrooms || 0;
        for (let i = 0; i < count; i++) {
            const stemMaterial = new THREE.MeshStandardMaterial({
                color: 0xa8bfcc,
                roughness: 0.7,
                metalness: 0.02,
                fog: true,
            });
            const capColor = capPalette[Math.floor(this.random() * capPalette.length)];
            const capMaterial = new THREE.MeshStandardMaterial({
                color: capColor.clone().multiplyScalar(0.45),
                emissive: capColor,
                emissiveIntensity: 0.65,
                roughness: 0.34,
                metalness: 0.08,
                fog: true,
            });
            const glowMaterial = new THREE.MeshBasicMaterial({
                color: capColor,
                transparent: true,
                opacity: 0.14,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
                fog: true,
            });

            const group = new THREE.Group();
            const stem = new THREE.Mesh(stemGeometry, stemMaterial);
            const cap = new THREE.Mesh(capGeometry, capMaterial);
            const glow = new THREE.Mesh(glowGeometry, glowMaterial);

            stem.position.y = 3.8;
            cap.position.y = 7.2;
            glow.position.y = 7.2;
            group.add(stem);
            group.add(cap);
            group.add(glow);

            const baseX = this.random(-820, 820);
            const baseY = this.random(-96, -90);
            const baseZ = this.random(-980, -420);
            const scale = this.random(0.55, 1.1);

            group.position.set(baseX, baseY, baseZ);
            group.scale.set(scale, scale, scale);
            group.rotation.y = this.random(0, Math.PI * 2);

            this.scene.add(group);
            this.gpuMushrooms.push({
                group,
                capMaterial,
                glowMaterial,
                baseY,
                baseScale: scale,
                pulse: 0,
                phase: this.random(0, Math.PI * 2),
                bobSpeed: this.random(0.9, 1.35),
            });
        }
    }

    createMoonbeamProps() {
        if (!this.scene || !this.qualityConfig) return;

        this.gpuMoonbeams = [];
        const beamGeometry = new THREE.PlaneGeometry(120, 980);

        const count = this.qualityConfig.moonbeams || 0;
        for (let i = 0; i < count; i++) {
            const material = new THREE.MeshBasicMaterial({
                color: 0xb8e4ff,
                transparent: true,
                opacity: this.random(0.18, 0.35),
                depthWrite: false,
                blending: THREE.AdditiveBlending,
                fog: true,
                side: THREE.DoubleSide,
            });
            const beam = new THREE.Mesh(beamGeometry, material);
            const baseOpacity = material.opacity;
            const x = this.random(-780, 780);
            const z = this.random(-1160, -520);
            const y = this.random(240, 300);
            const tilt = this.random(-0.22, 0.22);

            beam.position.set(x, y, z);
            beam.rotation.z = tilt;
            beam.rotation.y = this.random(-0.16, 0.16);
            beam.scale.x = this.random(0.7, 1.25);
            beam.scale.y = this.random(0.7, 1.15);
            this.scene.add(beam);

            this.gpuMoonbeams.push({
                mesh: beam,
                material,
                baseOpacity,
                pulse: 0,
                phase: this.random(0, Math.PI * 2),
                driftSpeed: this.random(0.3, 0.55),
                driftAmplitude: this.random(6, 18),
                baseX: x,
            });
        }
    }

    createWildlifeProps() {
        if (!this.scene || !this.qualityConfig) return;

        this.gpuWildlifeEyes = [];
        const eyeGeometry = new THREE.SphereGeometry(1.7, 8, 8);
        const count = this.qualityConfig.eyes || 0;

        for (let i = 0; i < count; i++) {
            const leftMaterial = new THREE.MeshBasicMaterial({
                color: 0xf9d779,
                transparent: true,
                opacity: 0.85,
                fog: true,
            });
            const rightMaterial = leftMaterial.clone();

            const leftEye = new THREE.Mesh(eyeGeometry, leftMaterial);
            const rightEye = new THREE.Mesh(eyeGeometry, rightMaterial);

            const group = new THREE.Group();
            const spacing = this.random(4.8, 8.2);
            leftEye.position.x = -spacing * 0.5;
            rightEye.position.x = spacing * 0.5;
            group.add(leftEye);
            group.add(rightEye);

            const x = this.random(-760, 760);
            const y = this.random(-48, 130);
            const z = this.random(-980, -450);
            group.position.set(x, y, z);
            group.rotation.y = this.random(-0.4, 0.4);
            this.scene.add(group);

            this.gpuWildlifeEyes.push({
                group,
                leftMaterial,
                rightMaterial,
                baseScale: this.random(0.75, 1.2),
                pulse: 0,
                blinkPhase: this.random(0, Math.PI * 2),
            });
        }
    }

    createLeafProps() {
        if (!this.scene || !this.qualityConfig) return;

        this.gpuLeaves = [];
        const leafGeometry = new THREE.PlaneGeometry(7.5, 12, 1, 1);
        const leafCount = this.qualityConfig.leaves || 0;
        const baseColor = new THREE.Color(0x3a6048);
        const accentColor = new THREE.Color(0x8b6b3a);

        for (let i = 0; i < leafCount; i++) {
            const colorBlend = this.random(0, 1);
            const leafColor = baseColor.clone().lerp(accentColor, colorBlend);
            leafColor.offsetHSL(this.random(-0.03, 0.03), this.random(-0.1, 0.08), this.random(-0.07, 0.06));

            const material = new THREE.MeshBasicMaterial({
                color: leafColor,
                transparent: true,
                opacity: this.random(0.32, 0.76),
                side: THREE.DoubleSide,
                depthWrite: false,
                fog: true,
            });
            const mesh = new THREE.Mesh(leafGeometry, material);
            mesh.frustumCulled = false;

            const startY = this.random(140, 460);
            const baseX = this.random(-900, 900);
            const baseZ = this.random(-1080, -420);
            const scale = this.random(0.45, 1.18);
            mesh.position.set(baseX, startY, baseZ);
            mesh.scale.setScalar(scale);
            mesh.rotation.set(
                this.random(-Math.PI, Math.PI),
                this.random(-Math.PI, Math.PI),
                this.random(-Math.PI, Math.PI),
            );
            this.scene.add(mesh);

            this.gpuLeaves.push({
                mesh,
                baseX,
                baseZ,
                startY,
                fallOffset: this.random(0, 420),
                fallSpeed: this.random(18, 36),
                driftAmplitude: this.random(10, 36),
                driftSpeed: this.random(0.35, 1.15),
                depthDrift: this.random(4, 18),
                spinX: this.random(-1.9, 1.9),
                spinY: this.random(-1.1, 1.1),
                spinZ: this.random(-1.6, 1.6),
                phase: this.random(0, Math.PI * 2),
            });
        }
    }

    createGPUForestProps() {
        if (!this.scene || !this.qualityConfig) return;

        this.createMushroomProps();
        this.createMoonbeamProps();
        this.createWildlifeProps();
        this.createLeafProps();
    }

    createReactiveFXSystem() {
        if (this.particleSystem) {
            this.particleSystem.dispose();
            this.particleSystem = null;
        }
        if (!this.scene || !this.qualityConfig) return;

        this.particleSystem = new MoonlitForestParticles({
            scene: this.scene,
            qualityConfig: this.qualityConfig,
            random: () => this.random(),
            renderer: this.renderer,
            isWebGPU: this.isWebGPU,
            useCompute: this.flags.useCompute,
        });
    }

    updateGPUForestProps(delta) {
        if (delta <= 0) return;
        const signals = this.fxController.getSignals();
        const mushroomEnvelope = Math.min(
            2.8,
            signals.mushroomPulse + (signals.linePulse * 0.35) + (signals.comboEnergy * 0.2),
        );
        const moonbeamEnvelope = Math.min(
            2.5,
            signals.moonbeamPulse + (signals.linePulse * 0.25) + (signals.comboEnergy * 0.18),
        );
        const wildlifeEnvelope = Math.min(
            2.8,
            signals.wildlifePulse + (signals.comboEnergy * 0.45) + (signals.pieceLockPulse * 0.2),
        );

        this.gpuMushrooms.forEach((mushroom) => {
            mushroom.pulse = Math.max(mushroom.pulse, mushroomEnvelope);
            mushroom.pulse = Math.max(0, mushroom.pulse - (delta * 1.9));
            const bob = Math.sin((this.time * mushroom.bobSpeed) + mushroom.phase);
            const pulseScale = 1 + (mushroom.pulse * 0.12);

            mushroom.group.position.y = mushroom.baseY + (bob * 0.55);
            mushroom.group.scale.setScalar(mushroom.baseScale * pulseScale);
            mushroom.capMaterial.emissiveIntensity = 0.65 + (mushroom.pulse * 0.8);
            mushroom.glowMaterial.opacity = 0.14 + (mushroom.pulse * 0.22);
        });

        this.gpuMoonbeams.forEach((beam) => {
            beam.pulse = Math.max(beam.pulse, moonbeamEnvelope);
            beam.pulse = Math.max(0, beam.pulse - (delta * 1.6));
            const wave = Math.sin((this.time * beam.driftSpeed) + beam.phase);
            beam.mesh.position.x = beam.baseX + (wave * beam.driftAmplitude);
            beam.material.opacity = Math.min(0.72, beam.baseOpacity + (wave * 0.035) + (beam.pulse * 0.28));
        });

        this.gpuWildlifeEyes.forEach((eyes) => {
            eyes.pulse = Math.max(eyes.pulse, wildlifeEnvelope);
            eyes.pulse = Math.max(0, eyes.pulse - (delta * 1.8));
            const blink = 0.7 + (Math.sin((this.time * 1.8) + eyes.blinkPhase) * 0.12);
            const scale = eyes.baseScale * (1 + (eyes.pulse * 0.22));
            eyes.group.scale.setScalar(scale);
            const opacity = Math.min(1, blink + (eyes.pulse * 0.3));
            eyes.leftMaterial.opacity = opacity;
            eyes.rightMaterial.opacity = opacity;
        });

        this.gpuLeaves.forEach((leaf) => {
            leaf.fallOffset += leaf.fallSpeed * delta;
            let y = leaf.startY - leaf.fallOffset;

            if (y < -140) {
                leaf.startY = this.random(180, 520);
                leaf.baseX = this.random(-920, 920);
                leaf.baseZ = this.random(-1120, -420);
                leaf.fallOffset = 0;
                y = leaf.startY;
            }

            const sway = Math.sin((this.time * leaf.driftSpeed) + leaf.phase);
            const depthShift = Math.cos((this.time * leaf.driftSpeed * 0.7) + leaf.phase);

            leaf.mesh.position.x = leaf.baseX + (sway * leaf.driftAmplitude);
            leaf.mesh.position.y = y;
            leaf.mesh.position.z = leaf.baseZ + (depthShift * leaf.depthDrift);
            leaf.mesh.rotation.x += leaf.spinX * delta;
            leaf.mesh.rotation.y += leaf.spinY * delta;
            leaf.mesh.rotation.z += leaf.spinZ * delta;
        });
    }

    updateReactiveFX(delta) {
        this.forestAtmospherePulse = Math.max(0, this.forestAtmospherePulse - (delta * 0.85));
        const signals = this.fxController.getSignals();
        const pulse = Math.max(
            this.forestAtmospherePulse,
            signals.atmospherePulse + (signals.comboEnergy * 0.2) + (signals.linePulse * 0.12),
        );

        if (this.moonLight) {
            this.moonLight.intensity = 0.84 + (pulse * 0.26);
        }
        if (this.ambientLight) {
            this.ambientLight.intensity = 0.56 + (pulse * 0.1);
        }
        if (this.scene?.fog) {
            this.scene.fog.density = 0.00038 + (pulse * 0.0002);
        }
        const postConfig = this.qualityConfig?.post ?? {};
        const bloomStrength = (postConfig.bloomStrength ?? 0.42) + (pulse * 0.1);
        const exposure = (postConfig.exposure ?? 1.09) + (pulse * 0.015);
        const saturation = (postConfig.saturation ?? 1.08) + (pulse * 0.02);
        const bloomChanged = this.lastPostBloomStrength === null
            || Math.abs(this.lastPostBloomStrength - bloomStrength) >= 0.01;
        const exposureChanged = this.lastPostExposure === null
            || Math.abs(this.lastPostExposure - exposure) >= 0.01;
        const saturationChanged = this.lastPostSaturation === null
            || Math.abs(this.lastPostSaturation - saturation) >= 0.01;

        if (this.postProcessing?.update && this.flags.usePost) {
            this.postUpdateAccumulator += delta;
            if (this.postUpdateAccumulator >= (1 / 20) && (bloomChanged || exposureChanged || saturationChanged)) {
                this.postProcessing.update({
                    bloomStrength,
                    exposure,
                    saturation,
                });
                this.lastPostBloomStrength = bloomStrength;
                this.lastPostExposure = exposure;
                this.lastPostSaturation = saturation;
                this.postUpdateAccumulator = 0;
            }
        } else {
            this.postUpdateAccumulator = 0;
        }

        if (this.flags.usePost && this.postProcessing?.bloomPass && bloomChanged) {
            this.postProcessing.bloomPass.strength = bloomStrength;
            this.lastPostBloomStrength = bloomStrength;
        }

        if (this.particleSystem) {
            this.particleUpdateAccumulator += delta;
            if (this.particleUpdateAccumulator >= this.getParticleUpdateStep()) {
                this.particleSystem.update(this.particleUpdateAccumulator, this.time);
                this.particleUpdateAccumulator = 0;
            }
        } else {
            this.particleUpdateAccumulator = 0;
        }
    }

    updateForestGeometry() {
        if (!this.forestLayerRuntime.length) return;

        this.forestLayerRuntime.forEach((layer) => {
            const {
                trunkMesh, canopyMesh, instances, swayLeanFactor,
            } = layer;
            instances.forEach((instance, index) => {
                const sway = Math.sin((this.time * instance.swaySpeed) + instance.phase)
                    * instance.swayAmplitude;
                const lean = sway * swayLeanFactor;

                this.tmpEuler.set(lean * 0.35, instance.yaw, 0);
                this.tmpQuaternion.setFromEuler(this.tmpEuler);
                this.tmpPosition.set(instance.x + sway, instance.y + (instance.trunkHeight * 0.5), instance.z);
                this.tmpScale.set(instance.trunkRadius, instance.trunkHeight, instance.trunkRadius);
                this.tmpMatrix.compose(this.tmpPosition, this.tmpQuaternion, this.tmpScale);
                trunkMesh.setMatrixAt(index, this.tmpMatrix);

                this.tmpEuler.set(lean, instance.yaw, 0);
                this.tmpQuaternion.setFromEuler(this.tmpEuler);
                this.tmpPosition.set(
                    instance.x + (sway * 1.2),
                    instance.y + instance.trunkHeight + (instance.canopyHeight * 0.45),
                    instance.z,
                );
                this.tmpScale.set(instance.canopyRadius, instance.canopyHeight, instance.canopyRadius);
                this.tmpMatrix.compose(this.tmpPosition, this.tmpQuaternion, this.tmpScale);
                canopyMesh.setMatrixAt(index, this.tmpMatrix);
            });
            trunkMesh.instanceMatrix.needsUpdate = true;
            canopyMesh.instanceMatrix.needsUpdate = true;
        });

        this.forestFogLayers.forEach((fogLayer) => {
            const wave = Math.sin((this.time * fogLayer.speed) + fogLayer.phase);
            fogLayer.mesh.position.x = fogLayer.baseX + (wave * fogLayer.amplitude);
            fogLayer.mesh.position.y = fogLayer.baseY + (Math.sin((this.time * fogLayer.speed * 0.7) + fogLayer.phase) * 4.5);
            fogLayer.mesh.position.z = fogLayer.baseZ + (Math.sin((this.time * fogLayer.speed * 0.4) + fogLayer.phase) * 8);
            fogLayer.mesh.material.opacity = fogLayer.baseOpacity + (wave * 0.012);
        });

        this.forestUndergrowthLayers.forEach((layer) => {
            const { mesh, instances } = layer;
            instances.forEach((instance, index) => {
                const sway = Math.sin((this.time * instance.swaySpeed) + instance.phase) * instance.swayAmplitude;
                this.tmpEuler.set(sway * 0.01, instance.yaw + (sway * 0.006), 0);
                this.tmpQuaternion.setFromEuler(this.tmpEuler);
                this.tmpPosition.set(instance.x + (sway * 0.45), instance.y + (instance.height * 0.5), instance.z);
                this.tmpScale.set(instance.radius, instance.height, instance.radius);
                this.tmpMatrix.compose(this.tmpPosition, this.tmpQuaternion, this.tmpScale);
                mesh.setMatrixAt(index, this.tmpMatrix);
            });
            mesh.instanceMatrix.needsUpdate = true;
        });

        this.forestFramingSilhouettes.forEach((silhouette) => {
            const wave = Math.sin((this.time * silhouette.swaySpeed) + silhouette.phase);
            silhouette.group.position.x = silhouette.baseX + (wave * silhouette.swayAmplitude);
            silhouette.group.position.y = silhouette.baseY + (wave * 0.7);
            silhouette.group.position.z = silhouette.baseZ + (Math.sin((this.time * silhouette.swaySpeed * 0.8) + silhouette.phase) * 1.8);
            silhouette.group.rotation.z = wave * 0.018;
            silhouette.group.rotation.y = silhouette.baseYaw + (wave * 0.004);
        });

        this.fogBasinLayers.forEach((layer) => {
            const wave = Math.sin((this.time * layer.speed) + layer.phase);
            const slowWave = Math.sin((this.time * layer.speed * 0.45) + layer.phase);
            layer.mesh.position.x = wave * layer.drift;
            layer.mesh.position.y = layer.baseY + (slowWave * 1.8);
            layer.mesh.position.z = layer.baseZ + (wave * 2.4);
            layer.mesh.material.opacity = layer.baseOpacity + (wave * 0.015);
        });
    }

    updateMoonPosition() {
        if (!this.camera || !this.moonMesh || !this.moonHalo) return;

        const moonX = 300 * this.camera.aspect;
        const moonY = 230;
        const moonZ = -900;
        this.moonMesh.position.set(moonX, moonY, moonZ);
        this.moonHalo.position.set(moonX, moonY, moonZ - 2);
    }

    updateRendererScene(delta) {
        this.time += delta;

        if (this.skyUniforms?.uTime) this.skyUniforms.uTime.value = this.time;
        if (this.starUniforms?.uTime) this.starUniforms.uTime.value = this.time;
        if (this.moonUniforms?.uTime) this.moonUniforms.uTime.value = this.time;
        if (this.moonHaloUniforms?.uTime) this.moonHaloUniforms.uTime.value = this.time;

        if (this.starfield) {
            this.starfield.rotation.y += delta * 0.004;
            this.starfield.rotation.z = Math.sin(this.time * 0.05) * 0.02;
        }

        if (this.camera) {
            this.camera.position.x = Math.sin(this.time * 0.06) * 2.5;
            this.camera.position.y = 34 + (Math.cos(this.time * 0.045) * 1.8);
            this.camera.lookAt(0, 20, -700);
        }

        this.sceneMotionAccumulator += delta;
        if (this.sceneMotionAccumulator >= this.getSceneMotionStep()) {
            const motionDelta = this.sceneMotionAccumulator;
            this.sceneMotionAccumulator = 0;
            this.updateForestGeometry();
            this.updateGPUForestProps(motionDelta);
        }
        this.updateReactiveFX(delta);
    }

    applyFXSignals() {
        const signals = this.fxController.getSignals();

        if (this.moonHaloUniforms?.uOpacity) {
            const baseOpacity = 0.2;
            const boostedOpacity = baseOpacity
                + (signals.comboEnergy * 0.024)
                + (signals.linePulse * 0.018)
                + (signals.pieceLockPulse * 0.012);
            this.moonHaloUniforms.uOpacity.value = Math.min(0.5, boostedOpacity);
        }

        if (this.moonUniforms?.uGlowIntensity) {
            const baseGlow = 0.58;
            const boostedGlow = baseGlow + (signals.comboEnergy * 0.05) + (signals.linePulse * 0.04);
            this.moonUniforms.uGlowIntensity.value = Math.min(1.0, boostedGlow);
        }
    }

    emitQueuedGpuEffects() {
        const bursts = this.fxController.drainParticleBursts();
        if (!this.particleSystem) return;

        const fireflies = this.scaleBurstCount(bursts.fireflies);
        const spores = this.scaleBurstCount(bursts.spores);
        const enchantedLeaves = this.scaleBurstCount(bursts.enchantedLeaves);
        const wisps = this.scaleBurstCount(bursts.wisps);
        const sparkles = this.scaleBurstCount(bursts.sparkles);
        const runes = this.scaleBurstCount(bursts.runes);
        const mist = this.scaleBurstCount(bursts.mist);
        const shootingStars = this.scaleBurstCount(bursts.shootingStars);
        const auroraStrength = this.scaleBurstStrength(bursts.auroraStrength);

        if (fireflies > 0) this.particleSystem.emitFireflies(fireflies);
        if (spores > 0) this.particleSystem.emitSpores(spores);
        if (enchantedLeaves > 0) this.particleSystem.emitEnchantedLeaves(enchantedLeaves);
        if (wisps > 0) this.particleSystem.emitWisps(wisps);
        if (sparkles > 0) this.particleSystem.emitSparkles(sparkles);
        if (runes > 0) this.particleSystem.emitRunes(runes);
        if (mist > 0) this.particleSystem.emitMist(mist);
        if (shootingStars > 0) this.particleSystem.emitShootingStars(shootingStars);
        if (auroraStrength > 0) this.particleSystem.triggerAurora(auroraStrength);
    }

    renderFrame() {
        if (!this.renderer || !this.scene || !this.camera) return;

        if (this.postProcessing && this.flags.usePost) {
            try {
                this.postProcessing.render();
                return;
            } catch (error) {
                console.warn('[MoonlitForest] Post render failed, disabling post path:', error);
                this.postProcessing?.dispose?.();
                this.postProcessing = null;
                this.flags.usePost = false;
                this.capabilities.post = false;
            }
        }

        try {
            this.renderer.render(this.scene, this.camera);
        } catch (error) {
            if (this.isWebGPU) {
                this.requestWebGLFallback('webgpu-render-failure', error);
            } else {
                console.error('[MoonlitForest] Render failure:', error);
            }
        }
    }

    startRendererLoop() {
        if (!this.renderer || !this.scene || !this.camera) return;

        this.lastFrameTime = performance.now();
        const animate = () => {
            if (!this.isActive || !this.renderer || !this.scene || !this.camera) return;

            const now = performance.now();
            const frameMs = Math.min(now - this.lastFrameTime, 100);
            let delta = Math.min(frameMs / 1000, 0.1);
            if (this.fixedDeltaSeconds) {
                delta = this.fixedDeltaSeconds;
                this.fixedElapsedTime += delta;
            }
            this.lastFrameTime = now;
            if (this.flags.baseline) {
                this.trackBaselineFrame(delta);
            }
            if (this.maybeHandleQualityTransition(delta)) {
                return;
            }
            if (!this.shouldRenderFrame()) {
                const frameId = requestAnimationFrame(animate);
                this.registerAnimation(frameId);
                return;
            }

            this.updateAdaptiveBudgets(frameMs, now);
            this.fxController.step(delta);
            this.emitQueuedGpuEffects();
            this.updateRendererScene(delta);
            this.applyFXSignals();
            this.renderFrame();

            const frameId = requestAnimationFrame(animate);
            this.registerAnimation(frameId);
        };

        const frameId = requestAnimationFrame(animate);
        this.registerAnimation(frameId);
    }

    onResize() {
        if (!this.renderer || !this.camera || typeof window === 'undefined') return;

        const width = window.innerWidth;
        const height = window.innerHeight;
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.applyAdaptiveBudgetState(true);
        this.lastAdaptiveApplyTime = performance.now();
        this.updateMoonPosition();
    }

    disposeSceneGraphObject(root) {
        if (!root) return;

        root.traverse((object) => {
            if (object.geometry) object.geometry.dispose();
            if (object.material) {
                if (Array.isArray(object.material)) {
                    object.material.forEach((material) => material?.dispose?.());
                } else {
                    object.material.dispose?.();
                }
            }
        });
    }

    cleanupRenderer() {
        this.clearBaselinePlaybackTimers();
        this.removeBaselineHelpers();
        this.removeResizeListener();
        this.clearManagedTimeouts();
        this.removeRendererResilienceListeners();

        this.postProcessing?.dispose?.();
        this.postProcessing = null;

        if (this.particleSystem) {
            this.particleSystem.dispose();
            this.particleSystem = null;
        }

        if (this.scene) {
            this.disposeSceneGraphObject(this.scene);
            this.scene.clear();
            this.scene = null;
        }

        if (this.renderer) {
            const { domElement } = this.renderer;
            this.renderer.onDeviceLost = null;
            this.disposeRenderer(this.renderer, { nullInstance: false });
            if (domElement?.parentNode) {
                domElement.parentNode.removeChild(domElement);
            }
            this.renderer = null;
        }

        this.camera = null;
        this.skyMesh = null;
        this.starfield = null;
        this.moonMesh = null;
        this.moonHalo = null;
        this.moonLight = null;
        this.ambientLight = null;
        this.warmFillLight = null;
        this.forestGround = null;
        this.forestLayerRuntime = [];
        this.forestFogLayers = [];
        this.forestUndergrowthLayers = [];
        this.forestFramingSilhouettes = [];
        this.fogBasinLayers = [];
        this.gpuMushrooms = [];
        this.gpuMoonbeams = [];
        this.gpuWildlifeEyes = [];
        this.gpuLeaves = [];
        this.particleSystem = null;
        this.gpuBudget = null;
        this.adaptiveBudgetState = {
            frameTimeEMA: 16.7,
            qualityScale: 1,
            resolutionScale: 1,
            baseResolutionScale: 1,
            emissionScale: 1,
        };
        this.lastRendererWidth = 0;
        this.lastRendererHeight = 0;
        this.lastRendererPixelRatio = 0;
        this.lastAppliedResolutionScale = 1;
        this.lastAdaptiveApplyTime = 0;
        this.postSuppressedByBudget = false;
        this.lastPostToggleTime = 0;
        this.sceneMotionAccumulator = 0;
        this.particleUpdateAccumulator = 0;
        this.postUpdateAccumulator = 0;
        this.lastPostBloomStrength = null;
        this.lastPostExposure = null;
        this.lastPostSaturation = null;
        this.forestAtmospherePulse = 0;
        this.skyUniforms = null;
        this.starUniforms = null;
        this.moonUniforms = null;
        this.moonHaloUniforms = null;
        this.time = 0;
        this.lastFrameTime = 0;
        this.fixedElapsedTime = 0;
        this.activeQualityLevel = 'high';
        this.qualityCheckAccumulator = 0;
        this.qualityTransitionInProgress = false;
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
        this.deviceLossRecoveryInProgress = false;
        this.renderFallbackInProgress = false;
        this.fxController.reset();
    }

    async createScene() {
        this.refreshRuntimeFlags();
        this.cancelAnimationLoop();
        this.clearEventSubscriptions();
        this.removeResizeListener();
        this.clearManagedTimeouts();
        this.cleanupRenderer();
        this.fxController.reset();
        this.forestAtmospherePulse = 0;

        const qualitySetting = this.getQualitySetting();
        this.qualityConfig = this.getQualityConfig(qualitySetting);
        this.activeQualityLevel = qualitySetting;
        this.qualityCheckAccumulator = 0;
        this.initializeAdaptiveBudgetState();

        this.debugLog('[MoonlitForest] Creating scene with quality:', qualitySetting, this.qualityConfig);

        const mainThemeContainer = this.getContainer('moonlit-forest-theme');
        if (!mainThemeContainer) {
            console.warn('[MoonlitForest] Theme container not found; skipping scene initialization.');
            return;
        }

        const rendererReady = await this.initRenderer(mainThemeContainer);
        if (!rendererReady) {
            console.error('[MoonlitForest] Renderer unavailable; Moonlit requires GPU renderer path.');
            return;
        }

        this.createRendererScene();
        this.setupPostProcessing();
        this.applyAdaptiveBudgetState(true);
        this.lastAdaptiveApplyTime = performance.now();
        this.updateMoonPosition();
        this.startRendererLoop();
        window.addEventListener('resize', this.boundResizeHandler);

        if (this.qualityConfig.fireflies > 0 && !this.particleSystem?.usesComputeAmbientField?.()) {
            for (let i = 0; i < this.qualityConfig.fireflies; i++) {
                this.setManagedTimeout(() => {
                    this.spawnAmbientFirefly();
                }, i * 1000);
            }
        }

        this.setupEventListeners();
        if (this.flags.baseline) {
            this.installBaselineHelpers();
            this.debugLog('[MoonlitBaseline] Baseline instrumentation enabled', {
                seed: this.flags.seed,
                fixedDtMs: this.flags.fixedDtMs,
                playback: this.flags.playback,
                playbackLoops: this.flags.playbackLoops,
            });
            if (this.flags.playback) {
                this.playBaselineSequence(this.flags.playback, {
                    loops: this.flags.playbackLoops,
                });
            }
        }
    }

    /**
     * Spawn a single ambient firefly that continuously respawns.
     */
    spawnAmbientFirefly() {
        if (!this.isActive || !this.particleSystem) return;

        this.particleSystem.emitAmbientFirefly();
        this.setManagedTimeout(() => {
            this.spawnAmbientFirefly();
        }, 900 + (this.random() * 3000));
    }

    setupEventListeners() {
        this.clearEventSubscriptions();

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
    }

    /**
     * React to line clears with mystical forest effects.
     */
    onLineClear(lineCount) {
        if (!this.qualityConfig) return;

        const directives = this.fxController.onLineClear(lineCount, this.qualityConfig);
        if (this.flags.baseline) {
            this.baselineEventCounts.lineClear += 1;
            this.lastBaselineEventDirectives.lineClear = { ...directives };
        }
        this.forestAtmospherePulse = Math.max(
            this.forestAtmospherePulse,
            0.2 + (directives.mushroomIntensity * 0.08),
        );

        this.brightenMushrooms(directives.mushroomIntensity);
        this.intensifyMoonbeams(directives.moonbeamIntensity);
        if (directives.fireflyCount > 0) this.spawnFireflies(directives.fireflyCount);
        if (directives.sporesCount > 0) this.releaseGlowingSpores(directives.sporesCount);
        if (directives.enchantedLeafCount > 0) this.spawnEnchantedLeaves(directives.enchantedLeafCount);
    }

    /**
     * React to combos with intensified GPU-only effects.
     */
    onCombo(comboCount) {
        if (!this.qualityConfig) return;

        const directives = this.fxController.onCombo(comboCount, this.qualityConfig);
        if (this.flags.baseline) {
            this.baselineEventCounts.combo += 1;
            this.lastBaselineEventDirectives.combo = { ...directives };
        }
        this.currentComboLevel = directives.combo;
        this.forestAtmospherePulse = Math.max(
            this.forestAtmospherePulse,
            Math.min(2.6, 0.55 + (directives.combo * 0.16)),
        );

        this.glowWildlifeEyes(directives.combo);
        this.createMagicalSparkles(directives.combo);
        this.intensifyForestAtmosphere(directives.combo);
        if (directives.wispCount > 0) this.spawnMysticalWisps(directives.wispCount);
        if (directives.combo >= 4) this.showAncientRunes(directives.combo);
        if (directives.combo >= 6) this.createMysticWave(directives.combo);
        if (directives.enableAurora) this.createAuroraShimmer(directives.combo);
        if (directives.enableShootingStars) this.spawnShootingStars(directives.combo);
    }

    /**
     * React to piece locks with subtle GPU accents.
     */
    onPieceLock() {
        const directives = this.fxController.onPieceLock(this.random(), this.random());
        if (this.flags.baseline) {
            this.baselineEventCounts.pieceLock += 1;
            this.lastBaselineEventDirectives.pieceLock = { ...directives };
        }
        if (directives.sparkleCount > 0) this.createSmallSparkle();
        if (directives.mistCount > 0) this.spawnMistParticle();
    }

    /**
     * Brighten glowing mushrooms.
     */
    brightenMushrooms(intensity) {
        if (this.gpuMushrooms.length <= 0) return;

        const mushroomsToPulse = Math.min(
            Math.ceil(intensity * 5),
            this.gpuMushrooms.length,
        );
        for (let i = 0; i < mushroomsToPulse; i++) {
            const mushroom = this.gpuMushrooms[Math.floor(this.random() * this.gpuMushrooms.length)];
            if (mushroom) {
                mushroom.pulse = Math.max(mushroom.pulse, 0.55 + (intensity * 0.5));
            }
        }
    }

    /**
     * Intensify moonbeams.
     */
    intensifyMoonbeams(intensity) {
        if (this.gpuMoonbeams.length <= 0) return;

        const beamsToPulse = Math.min(
            Math.ceil(intensity * 3),
            this.gpuMoonbeams.length,
        );
        for (let i = 0; i < beamsToPulse; i++) {
            const beam = this.gpuMoonbeams[Math.floor(this.random() * this.gpuMoonbeams.length)];
            if (beam) {
                beam.pulse = Math.max(beam.pulse, 0.5 + (intensity * 0.65));
            }
        }
    }

    /**
     * Make wildlife eyes glow brighter.
     */
    glowWildlifeEyes(comboCount) {
        if (this.gpuWildlifeEyes.length <= 0) return;

        const pulseStrength = Math.min(2.6, 0.5 + (comboCount * 0.24));
        this.gpuWildlifeEyes.forEach((eyes) => {
            eyes.pulse = Math.max(eyes.pulse, pulseStrength);
        });
    }

    /**
     * Spawn magical fireflies.
     */
    spawnFireflies(count) {
        if (!this.particleSystem || count <= 0) return;
        this.particleSystem.emitFireflies(count);
    }

    /**
     * Create magical sparkles.
     */
    createMagicalSparkles(comboCount) {
        if (!this.particleSystem) return;

        const sparkleCount = Math.min(comboCount * 2, 10);
        this.particleSystem.emitSparkles(sparkleCount);
        if (comboCount >= 4) {
            this.particleSystem.emitRunes(Math.min(4, Math.floor(comboCount * 0.6)));
        }
    }

    /**
     * Create a small sparkle on piece lock.
     */
    createSmallSparkle() {
        this.particleSystem?.emitSparkles(1);
    }

    /**
     * Intensify forest atmosphere.
     */
    intensifyForestAtmosphere(comboCount) {
        if (!this.particleSystem) return;

        this.forestAtmospherePulse = Math.max(
            this.forestAtmospherePulse,
            Math.min(2.4, 0.55 + (comboCount * 0.22)),
        );
        this.particleSystem.emitMist(Math.max(1, Math.floor(comboCount * 0.7)));
    }

    /**
     * Create a mystic wave accent for high combos.
     */
    createMysticWave(comboCount) {
        if (!this.particleSystem) return;

        const runeAccentCount = Math.max(1, Math.min(3, Math.floor(comboCount * 0.25)));
        this.particleSystem.emitRunes(runeAccentCount);
        this.particleSystem.emitSparkles(Math.max(2, Math.min(6, Math.floor(comboCount * 0.6))));
    }

    /**
     * Release glowing spores that float upward.
     */
    releaseGlowingSpores(count) {
        if (!this.particleSystem || count <= 0) return;
        this.particleSystem.emitSpores(count);
    }

    /**
     * Spawn enchanted glowing leaves.
     */
    spawnEnchantedLeaves(count) {
        if (!this.particleSystem || count <= 0) return;
        this.particleSystem.emitEnchantedLeaves(count);
    }

    /**
     * Spawn mystical wisps.
     */
    spawnMysticalWisps(count) {
        if (!this.particleSystem || count <= 0) return;
        this.particleSystem.emitWisps(count);
    }

    /**
     * Show ancient mystical runes.
     */
    showAncientRunes(comboCount) {
        if (!this.particleSystem) return;

        const runeCount = Math.min(comboCount * 2, 8);
        this.particleSystem.emitRunes(runeCount);
    }

    /**
     * Create aurora shimmer effect.
     */
    createAuroraShimmer(comboCount) {
        this.particleSystem?.triggerAurora(comboCount);
    }

    /**
     * Spawn shooting stars that streak across the sky.
     */
    spawnShootingStars(comboCount) {
        if (!this.particleSystem) return;

        const starCount = Math.min(comboCount, 6);
        this.particleSystem.emitShootingStars(starCount);
    }

    /**
     * Spawn subtle mist particles that drift.
     */
    spawnMistParticle() {
        this.particleSystem?.emitMist(1);
    }

    stop() {
        this.cancelAnimationLoop();
        this.clearEventSubscriptions();
        this.clearBaselinePlaybackTimers();
        this.removeBaselineHelpers();

        this.currentComboLevel = 0;
        this.gpuMushrooms = [];
        this.gpuMoonbeams = [];
        this.gpuWildlifeEyes = [];
        this.gpuLeaves = [];
        this.particleSystem = null;
        this.forestAtmospherePulse = 0;
        this.fxController.reset();
        this.clearManagedTimeouts();
        this.resetBaseline();

        this.cleanupRenderer();
        this.deviceLossRecoveryInProgress = false;
        this.renderFallbackInProgress = false;
        super.stop();
    }

    /**
     * Provide Moonlit Forest themed tetromino styling (mystical glowing forest)
     * @returns {Object} Moonlit Forest tetromino configuration
     */
    getTetrominoConfig() {
        return MOONLIT_FOREST_TETROMINOS;
    }
}
