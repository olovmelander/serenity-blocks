/**
 * @fileoverview Performance monitoring and profiling utilities
 * Tracks FPS, frame time, input latency, memory usage, and other metrics
 */

import { eventBus, EVENTS } from '../events/event-bus.js';
import { escapeHtml } from './dom-safety.js';

const FRAME_BUDGET_MS = 16.67; // 60fps target
const SAMPLE_SIZE = 60; // 1 second worth of samples at 60fps
const FRAME_TIME_LOG_LIMIT = 30000;
const MEMORY_CHECK_INTERVAL = 1000; // Check memory every second
const DISPLAY_UPDATE_INTERVAL = 500; // Update display every 500ms for stability
const GRAPH_WIDTH = 240; // Width of frame time graph in pixels
const GRAPH_HEIGHT = 50; // Height of frame time graph in pixels
const SECTION_SAMPLE_SIZE = 90;

function finiteDrawCount(value) {
    return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Resolve draw calls owned by the active theme plus the shared background renderer.
 * Phaser board draws are intentionally excluded until that renderer exposes a
 * compatible counter; the overlay labels this narrower contract explicitly.
 *
 * @param {Window|Object|null} windowRef
 * @returns {number}
 */
export function resolveActiveThemeDrawCalls(windowRef = globalThis?.window) {
    if (!windowRef) return 0;

    const manager = windowRef.themeManager;
    const sharedRenderer = manager?.webglRenderer ?? null;
    const sharedCalls = finiteDrawCount(
        sharedRenderer?.lastFrameDrawCalls ?? windowRef.activeDrawCalls,
    );
    const activeTheme = manager?.activeTheme;
    const dedicatedRenderer = activeTheme?.renderer ?? null;

    if (!activeTheme?.isActive || !dedicatedRenderer || dedicatedRenderer === sharedRenderer) {
        return sharedCalls;
    }

    const renderInfo = dedicatedRenderer.info?.render ?? {};
    const dedicatedCalls = finiteDrawCount(
        renderInfo.drawCalls ?? renderInfo.calls,
    );
    return sharedCalls + dedicatedCalls;
}

function simplifyGPUName(raw = '') {
    if (!raw) return '';

    let label = String(raw);
    const angleMatch = label.match(/ANGLE \((.+)\)/);
    if (angleMatch) {
        label = angleMatch[1];
    }

    const parts = label.split(',').map((part) => part.trim()).filter(Boolean);
    if (parts.length > 1) {
        return parts[1];
    }

    return parts[0] || label;
}

function escapeAttribute(value = '') {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/**
 * Performance Monitor - tracks game performance metrics in real-time
 */
/**
 * Median / max of a small rolling sample window. Kept module-scope and copy-then-sort rather
 * than sorting in place: `_counterSamples` is a live rolling window and reordering it would
 * corrupt the shift()-based eviction that keeps it bounded.
 * @param {number[]} values
 * @returns {number}
 */
function medianOf(values) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor((sorted.length - 1) / 2)];
}

/**
 * @param {number[]} values
 * @returns {number}
 */
function maxOf(values) {
    let out = 0;
    for (let i = 0; i < values.length; i += 1) if (values[i] > out) out = values[i];
    return out;
}

export class PerformanceMonitor {
    constructor() {
        this.enabled = false;
        this.startTime = 0;

        // Metrics storage
        this.metrics = {
            fps: 0,
            avgFPS: 0,
            minFPS: Infinity,
            maxFPS: 0,
            frameTime: 0,
            avgFrameTime: 0,
            maxFrameTime: 0,
            updateTime: 0,
            renderTime: 0,
            inputLatency: 0,
            memoryUsed: 0,
            frameDrops: 0,
            totalFrames: 0,
            contextRestoreCount: 0,
            themeSwitchCount: 0,
        };

        this._consecutiveDrops = 0;
        this._hasEmittedDownscale = false;

        // Sample buffers
        this.frameTimes = [];
        this.frameTimeLog = [];
        this.fpsHistory = [];
        this.inputLatencyHistory = [];

        // Timing markers
        this.lastFrameTime = 0;
        this.updateStartTime = 0;
        this.renderStartTime = 0;
        this.inputTimestamp = 0;

        // Memory tracking
        this.memoryInterval = null;
        this.memoryHistory = [];

        // Long-task / long-animation-frame tracking (audit SB-09: the monitor had
        // frame-time percentiles but no main-thread stall attribution). Observers
        // only fire ON long tasks, so idle cost is zero. Ring-buffered like spikes.
        this.longTasks = {
            count: 0, totalMs: 0, maxMs: 0, recent: [],
        };
        this._longTaskObserver = null;
        this._loafObserver = null;
        this._initLongTaskObservers();

        // UI overlay element
        this.overlayElement = null;
        this.showOverlay = false;
        this.graphCanvas = null;
        this.graphContext = null;
        this.overlayUpdateHandle = null;
        this.overlayUpdateInterval = null;
        this.frameListenerHandle = null;
        this.frameListenerInterval = null;
        this.sectionTimers = new Map();
        this.sectionMetrics = new Map();

        // Phase D.1: renderer.info-style counters surfaced live in the overlay.
        // Themes call recordCounters({calls, triangles, geometries, textures,
        // programs}) once per frame after rendering; we keep a rolling avg so
        // the overlay number doesn't flicker. Whichever counter is the largest
        // tells us the dominant cost class (draw calls vs vertex vs material).
        this.renderCounters = {
            calls: 0,
            triangles: 0,
            geometries: 0,
            textures: 0,
            programs: 0,
            callsAvg: 0,
            trianglesAvg: 0,
        };
        this._counterSamples = { calls: [], triangles: [] };

        // Quality mode tracking
        this.qualityMode = 'Unknown';

        // Keyboard toggle listener
        this.boundKeyHandler = null;

        // Display update throttling
        this.lastDisplayUpdate = 0;
        this.displayMetricsCache = null;
        this.collectionMode = 'disabled';
        this.samplingActive = false;
        this.samplingReasons = new Set();
        this.runtimeEvents = [];
        this.themeSwitches = [];
        this.latestNetworkStats = null;
        this.eventUnsubscribers = [];
        this.desktopGpuDiagnostics = null;
        this.desktopGpuRefreshPromise = null;
        this.desktopPerformancePolicy = null;

        console.log('[PerformanceMonitor] Initialized');
    }

    /**
     * Enable performance monitoring
     */
    enable({ samplingReason = null } = {}) {
        if (this.enabled) {
            if (samplingReason) {
                this.setSamplingReason(samplingReason, true);
            }
            this.refreshCollectionMode();
            return;
        }

        this.enabled = true;

        // Reset metrics
        this.reset();

        // Setup F3 toggle hotkey
        this.setupKeyboardToggle();
        this.bindRuntimeEvents();
        this.refreshDesktopGpuDiagnostics();
        if (samplingReason) {
            this.samplingReasons.add(samplingReason);
        }
        if (this.showOverlay) {
            this.samplingReasons.add('overlay');
        }
        this.updateSamplingActivity();

        console.log('[PerformanceMonitor] Enabled');
    }

    /**
     * Disable performance monitoring
     */
    disable() {
        if (!this.enabled) return;

        this.enabled = false;
        this.collectionMode = 'disabled';
        this.samplingActive = false;
        this.samplingReasons.clear();

        // Remove keyboard listener
        this.removeKeyboardToggle();
        this.stopSamplingLoops();
        this.stopOverlayUpdates();
        this.unbindRuntimeEvents();

        console.log('[PerformanceMonitor] Disabled');
    }

    startSamplingLoops() {
        if (performance.memory && !this.memoryInterval) {
            this.memoryInterval = setInterval(() => {
                this.updateMemoryMetrics();
            }, MEMORY_CHECK_INTERVAL);
        }

        this.startFrameListener();
    }

    stopSamplingLoops() {
        if (this.memoryInterval) {
            clearInterval(this.memoryInterval);
            this.memoryInterval = null;
        }

        this.stopFrameListener();
    }

    refreshCollectionMode() {
        if (!this.enabled) {
            this.collectionMode = 'disabled';
            return;
        }

        if (this.samplingActive) {
            this.collectionMode = this.showOverlay ? 'collecting_with_overlay' : 'collecting';
            return;
        }

        this.collectionMode = this.showOverlay ? 'overlay-waiting' : 'armed';
    }

    updateSamplingActivity() {
        const shouldSample = this.enabled && this.samplingReasons.size > 0;

        if (shouldSample && !this.samplingActive) {
            this.samplingActive = true;
            this.startSamplingLoops();
        } else if (!shouldSample && this.samplingActive) {
            this.samplingActive = false;
            this.stopSamplingLoops();
        }

        this.refreshCollectionMode();
    }

    setSamplingReason(reason, isActive) {
        if (!reason) return;

        if (isActive) {
            this.samplingReasons.add(reason);
        } else {
            this.samplingReasons.delete(reason);
        }

        this.updateSamplingActivity();
    }

    /**
     * Reset all metrics
     */
    reset() {
        this.startTime = performance.now();
        this.lastFrameTime = this.startTime;

        this.metrics = {
            fps: 0,
            avgFPS: 0,
            minFPS: Infinity,
            maxFPS: 0,
            frameTime: 0,
            avgFrameTime: 0,
            maxFrameTime: 0,
            updateTime: 0,
            renderTime: 0,
            inputLatency: 0,
            memoryUsed: 0,
            frameDrops: 0,
            totalFrames: 0,
            contextRestoreCount: 0,
            themeSwitchCount: 0,
        };

        this._consecutiveDrops = 0;
        this._hasEmittedDownscale = false;

        this.frameTimes = [];
        this.frameTimeLog = [];
        this.fpsHistory = [];
        this.inputLatencyHistory = [];
        this.memoryHistory = [];
        this.runtimeEvents = [];
        this.themeSwitches = [];
        this.latestNetworkStats = null;
        this.sectionTimers.clear();
        this.sectionMetrics.clear();
        this.renderCounters = {
            calls: 0,
            triangles: 0,
            geometries: 0,
            textures: 0,
            programs: 0,
            callsAvg: 0,
            trianglesAvg: 0,
        };
        this._counterSamples = { calls: [], triangles: [] };

        console.log('[PerformanceMonitor] Metrics reset');
    }

    /**
     * Start tracking a named section (for hotspot profiling)
     * @param {string} name
     */
    startSection(name) {
        if (!this.enabled || !name) return;
        this.sectionTimers.set(name, performance.now());
    }

    /**
     * End tracking a named section
     * @param {string} name
     */
    endSection(name) {
        if (!this.enabled || !name) return;
        const start = this.sectionTimers.get(name);
        if (!start) return;
        this.sectionTimers.delete(name);
        const duration = performance.now() - start;

        let metrics = this.sectionMetrics.get(name);
        if (!metrics) {
            metrics = {
                samples: [],
                avg: 0,
                max: 0,
                last: 0,
            };
            this.sectionMetrics.set(name, metrics);
        }

        metrics.samples.push(duration);
        if (metrics.samples.length > SECTION_SAMPLE_SIZE) {
            metrics.samples.shift();
        }
        metrics.avg = this.calculateAverage(metrics.samples);
        metrics.max = Math.max(metrics.max, duration);
        metrics.last = duration;
    }

    /**
     * Get top sections sorted by average duration
     * @param {number} limit
     * @returns {Array<{name:string, avg:number, last:number, max:number}>}
     */
    getTopSections(limit = 3) {
        const sections = [];
        this.sectionMetrics.forEach((metrics, name) => {
            if (metrics.samples.length === 0) return;
            sections.push({
                name,
                avg: metrics.avg,
                last: metrics.last,
                max: metrics.max,
            });
        });
        sections.sort((a, b) => b.avg - a.avg);
        return sections.slice(0, limit);
    }

    /**
     * Mark the start of a frame
     */
    frameStart() {
        if (!this.enabled) return;

        const now = performance.now();
        const delta = now - this.lastFrameTime;
        const frameTime = Number.isFinite(delta) && delta > 0 ? delta : FRAME_BUDGET_MS;

        // Record frame time
        this.frameTimes.push(frameTime);
        if (this.frameTimes.length > SAMPLE_SIZE) {
            this.frameTimes.shift();
        }
        this.frameTimeLog.push(frameTime);
        if (this.frameTimeLog.length > FRAME_TIME_LOG_LIMIT) {
            this.frameTimeLog.shift();
        }

        // Calculate FPS
        const fps = 1000 / frameTime;
        this.fpsHistory.push(fps);
        if (this.fpsHistory.length > SAMPLE_SIZE) {
            this.fpsHistory.shift();
        }

        // Update metrics
        this.metrics.frameTime = frameTime;
        this.metrics.fps = fps;
        this.metrics.totalFrames++;

        // Track frame drops (frames taking longer than budget)
        if (frameTime > FRAME_BUDGET_MS * 1.5) {
            this.metrics.frameDrops++;
            this._consecutiveDrops++;

            // Phase J: spike logger. Catch the tail of frames (>2× budget =
            // 33ms = below 30 fps) and record context so we can identify what
            // actually caused the stutter. Context comes from a registered
            // collector (themes/systems can register one); fallback to a
            // minimal record. Ring buffer caps memory at 100 spikes.
            if (frameTime > FRAME_BUDGET_MS * 2) {
                if (!this.spikes) this.spikes = [];
                const ctx = (typeof this._spikeContextCollector === 'function')
                    ? this._spikeContextCollector() : {};
                this.spikes.push({
                    t: Math.round(now),
                    ms: +frameTime.toFixed(1),
                    fps: +(1000 / frameTime).toFixed(1),
                    p50Before: +this.calculatePercentile(this.frameTimes.slice(0, -1), 50).toFixed(1),
                    ...ctx,
                });
                if (this.spikes.length > 100) this.spikes.shift();
            }

            // Adaptive downscaling for heavy themes dropping below ~40 FPS for a sustained second
            if (this._consecutiveDrops > 30 && !this._hasEmittedDownscale) {
                console.warn(`[PerformanceMonitor] Sustained frame drops detected (${this._consecutiveDrops} consecutive). Requesting global resolution downscale.`);
                this._hasEmittedDownscale = true;
                eventBus.emit(EVENTS.PERFORMANCE_DOWNSCALE);
            }
        } else if (frameTime <= FRAME_BUDGET_MS * 1.2) {
            // Recover drops if we stabilize
            this._consecutiveDrops = Math.max(0, this._consecutiveDrops - 1);
        }

        // Update min/max FPS
        if (fps < this.metrics.minFPS) this.metrics.minFPS = fps;
        if (fps > this.metrics.maxFPS) this.metrics.maxFPS = fps;
        if (frameTime > this.metrics.maxFrameTime) this.metrics.maxFrameTime = frameTime;

        // Calculate averages.
        //
        // avgFPS is THROUGHPUT — 1000 / mean(frameTime) — not mean(1000 / frameTime).
        // Averaging reciprocals is Jensen's inequality in action: it weights cheap
        // frames far above the expensive ones that actually consume wall-clock time.
        // On a bimodal trace (many 8ms frames plus a few 100ms stalls) that reported
        // ~2x the real rate and hid exactly the stutter players feel — a panel could
        // show "114.0 FPS" next to its own avgFrameTime of 17.2ms (= 58 fps).
        // See docs/GAMEPLAY_SMOOTHNESS_INVESTIGATION_2026-08.md §1.
        this.metrics.avgFrameTime = this.calculateAverage(this.frameTimes);
        this.metrics.avgFPS = this.metrics.avgFrameTime > 0
            ? 1000 / this.metrics.avgFrameTime
            : 0;

        this.lastFrameTime = now;
    }

    /**
     * Mark the start of game update
     */
    updateStart() {
        if (!this.enabled) return;
        this.updateStartTime = performance.now();
    }

    /**
     * Mark the end of game update
     */
    updateEnd() {
        if (!this.enabled) return;
        this.metrics.updateTime = performance.now() - this.updateStartTime;
    }

    /**
     * Mark the start of rendering
     */
    renderStart() {
        if (!this.enabled) return;
        this.renderStartTime = performance.now();
    }

    /**
     * Mark the end of rendering
     */
    renderEnd() {
        if (!this.enabled) return;
        this.metrics.renderTime = performance.now() - this.renderStartTime;
    }

    /**
     * Record input event (for latency tracking)
     */
    recordInput() {
        if (!this.enabled) return;
        this.inputTimestamp = performance.now();
    }

    /**
     * Record input action completion (to measure latency)
     */
    recordInputAction() {
        if (!this.enabled || !this.inputTimestamp) return;

        const latency = performance.now() - this.inputTimestamp;
        this.inputLatencyHistory.push(latency);
        if (this.inputLatencyHistory.length > SAMPLE_SIZE) {
            this.inputLatencyHistory.shift();
        }

        this.metrics.inputLatency = this.calculateAverage(this.inputLatencyHistory);
        this.inputTimestamp = 0;
    }

    bindRuntimeEvents() {
        if (this.eventUnsubscribers.length > 0) return;

        this.eventUnsubscribers.push(
            eventBus.on(EVENTS.CONTEXT_RESTORED, (payload) => {
                this.metrics.contextRestoreCount += 1;
                this.recordEvent('context_restored', payload);
            }),
            eventBus.on(EVENTS.THEME_CHANGED, ({ themeName }) => {
                this.recordEvent('theme_changed', { themeName });
            }),
        );
    }

    unbindRuntimeEvents() {
        this.eventUnsubscribers.forEach((unsubscribe) => unsubscribe?.());
        this.eventUnsubscribers = [];
    }

    recordEvent(type, payload = {}) {
        const entry = {
            type,
            timestamp: Date.now(),
            payload,
        };

        this.runtimeEvents.push(entry);
        if (this.runtimeEvents.length > 200) {
            this.runtimeEvents.shift();
        }
    }

    recordThemeSwitch({ fromTheme = null, toTheme = null, durationMs = 0 } = {}) {
        this.metrics.themeSwitchCount += 1;
        this.themeSwitches.push({
            fromTheme,
            toTheme,
            durationMs,
            timestamp: Date.now(),
        });
        if (this.themeSwitches.length > 100) {
            this.themeSwitches.shift();
        }
        this.recordEvent('theme_switch', { fromTheme, toTheme, durationMs });
    }

    setNetworkStats(stats) {
        this.latestNetworkStats = stats;
    }

    setDesktopGpuDiagnostics(diagnostics) {
        if (!diagnostics || typeof diagnostics !== 'object') {
            return;
        }

        this.desktopGpuDiagnostics = {
            activeWebGLRenderer: diagnostics.activeWebGLRenderer || null,
            gpuFeatureStatus: diagnostics.gpuFeatureStatus || null,
            adapters: Array.isArray(diagnostics.adapters) ? diagnostics.adapters : [],
            gpuSwitches: diagnostics.gpuSwitches || {},
            auxAttributes: diagnostics.auxAttributes || {},
            gpuHealth: diagnostics.gpuHealth || null,
            activeAdapter: diagnostics.activeAdapter || null,
            driverVendor: diagnostics.driverVendor || null,
            driverVersion: diagnostics.driverVersion || null,
            angleBackend: diagnostics.angleBackend || null,
            updatedAt: diagnostics.updatedAt || null,
        };
    }

    setDesktopPerformancePolicy(policy) {
        if (!policy || typeof policy !== 'object') {
            this.desktopPerformancePolicy = null;
            return;
        }

        this.desktopPerformancePolicy = {
            ...policy,
            pixelRatioCaps: policy.pixelRatioCaps ? { ...policy.pixelRatioCaps } : null,
            internalRenderResolution: policy.internalRenderResolution
                ? { ...policy.internalRenderResolution }
                : null,
            gpuHealth: policy.gpuHealth ? { ...policy.gpuHealth } : null,
        };
    }

    async refreshDesktopGpuDiagnostics() {
        if (this.desktopGpuRefreshPromise || typeof window === 'undefined' || !window.electronAPI?.getGPUDiagnostics) {
            return this.desktopGpuRefreshPromise;
        }

        this.desktopGpuRefreshPromise = window.electronAPI.getGPUDiagnostics()
            .then((diagnostics) => {
                this.setDesktopGpuDiagnostics(diagnostics);
                return diagnostics;
            })
            .catch((error) => {
                console.warn('[PerformanceMonitor] Failed to fetch desktop GPU diagnostics:', error?.message || error);
                return null;
            })
            .finally(() => {
                this.desktopGpuRefreshPromise = null;
            });

        return this.desktopGpuRefreshPromise;
    }

    getDesktopGpuOverlayInfo() {
        if (!this.desktopGpuDiagnostics) {
            return null;
        }

        const adapters = Array.isArray(this.desktopGpuDiagnostics.adapters)
            ? this.desktopGpuDiagnostics.adapters
            : [];
        const adapterLabel = adapters
            .map((adapter) => `${adapter.active ? '* ' : ''}${adapter.name || adapter.vendor || 'Unknown GPU'}`)
            .join(' | ');
        const adapterTitle = adapters
            .map((adapter) => {
                const details = [
                    adapter.active ? 'active' : 'inactive',
                    adapter.vendor,
                    adapter.name,
                    adapter.driverVersion ? `driver ${adapter.driverVersion}` : null,
                ].filter(Boolean);
                return details.join(' · ');
            })
            .join('\n');

        const featureStatus = this.desktopGpuDiagnostics.gpuFeatureStatus || {};
        const featureSummary = [
            featureStatus.gpu_compositing ? `compositing: ${featureStatus.gpu_compositing}` : null,
            featureStatus.webgl ? `webgl: ${featureStatus.webgl}` : null,
            featureStatus.webgl2 ? `webgl2: ${featureStatus.webgl2}` : null,
        ].filter(Boolean).join(' · ');

        const gpuSwitches = this.desktopGpuDiagnostics.gpuSwitches || {};
        const switchSummary = Object.entries(gpuSwitches)
            .map(([name, value]) => (value === true ? name : `${name}=${value}`))
            .join(', ');
        const gpuHealth = this.desktopGpuDiagnostics.gpuHealth || this.desktopPerformancePolicy?.gpuHealth || null;

        return {
            adapterLabel,
            adapterTitle,
            featureSummary,
            switchSummary,
            healthSummary: gpuHealth?.status ? `health: ${gpuHealth.status}` : null,
            angleBackend: this.desktopGpuDiagnostics.angleBackend || null,
        };
    }

    calculatePercentile(values, percentile) {
        if (!values.length) return 0;
        const sorted = [...values].sort((a, b) => a - b);
        const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((percentile / 100) * sorted.length)));
        return sorted[index];
    }

    getReleaseGateSnapshot() {
        return {
            frameTime: {
                p50: this.calculatePercentile(this.frameTimes, 50),
                p95: this.calculatePercentile(this.frameTimes, 95),
                p99: this.calculatePercentile(this.frameTimes, 99),
            },
            fps: {
                p50: this.calculatePercentile(this.fpsHistory, 50),
                p05: this.calculatePercentile(this.fpsHistory, 5),
            },
            memory: {
                currentMb: this.metrics.memoryUsed,
                peakMb: this.memoryHistory.length ? Math.max(...this.memoryHistory) : this.metrics.memoryUsed,
            },
            themeSwitches: {
                count: this.themeSwitches.length,
                maxDurationMs: this.themeSwitches.length ? Math.max(...this.themeSwitches.map((entry) => entry.durationMs || 0)) : 0,
            },
            runtime: {
                contextRestoreCount: this.metrics.contextRestoreCount,
                recentEvents: this.runtimeEvents.slice(-10),
            },
            network: this.latestNetworkStats,
        };
    }

    getRecentRuntimeEvents(limit = 40) {
        if (!Number.isFinite(limit) || limit <= 0) {
            return [];
        }
        return this.runtimeEvents.slice(-limit);
    }

    findRuntimeEvent(types = [], { fromEnd = false } = {}) {
        if (!Array.isArray(types) || types.length === 0) {
            return null;
        }

        const entries = fromEnd ? [...this.runtimeEvents].reverse() : this.runtimeEvents;
        return entries.find((entry) => types.includes(entry.type)) || null;
    }

    getRuntimeDuration(startTypes = [], endTypes = []) {
        const startEntry = this.findRuntimeEvent(startTypes);
        const endEntry = this.findRuntimeEvent(endTypes, { fromEnd: true });
        if (!startEntry || !endEntry) {
            return null;
        }

        const durationMs = endEntry.timestamp - startEntry.timestamp;
        return Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : null;
    }

    getEventPayloadDuration(types = []) {
        const eventEntry = this.findRuntimeEvent(types, { fromEnd: true });
        const durationMs = eventEntry?.payload?.durationMs;
        return Number.isFinite(durationMs) ? durationMs : null;
    }

    getStartupDurations() {
        return {
            introRendererInitMs: this.getEventPayloadDuration(['startup_intro_renderer_init_completed'])
                ?? this.getRuntimeDuration(['startup_intro_renderer_init_started'], ['startup_intro_renderer_init_completed']),
            audioTrackInitMs: this.getEventPayloadDuration(['startup_intro_music_init_completed'])
                ?? this.getRuntimeDuration(['startup_intro_music_init_started'], ['startup_intro_music_init_completed']),
            serenityBlocksInitMs: this.getEventPayloadDuration(['startup_app_init_completed'])
                ?? this.getRuntimeDuration(['startup_app_init_started'], ['startup_app_init_completed']),
            initialThemeReadyMs: this.getEventPayloadDuration(['startup_initial_theme_ready'])
                ?? this.getRuntimeDuration(['startup_initial_theme_started'], ['startup_initial_theme_ready']),
            serenityHubFirstIconReadyMs: this.getEventPayloadDuration(['startup_hub_icons_ready'])
                ?? this.getRuntimeDuration(['startup_bootstrap_begin'], ['startup_hub_icons_ready']),
            firstUsableFrameMs: this.getRuntimeDuration(['startup_bootstrap_begin'], ['startup_first-usable-frame']),
        };
    }

    createDesktopInvestigationSnapshot({
        stage = 'unknown',
        appMode = 'browser-dev',
        settingsSnapshot = null,
        runtimeConfig = null,
        processMetrics = null,
        windowBounds = null,
        displayScaleFactor = null,
        devicePixelRatio = null,
        runtimeProfile = null,
        extra = {},
    } = {}) {
        return {
            generatedAt: new Date().toISOString(),
            stage,
            appMode,
            runtimeConfig,
            runtimeProfile,
            settingsSnapshot,
            processMetrics,
            windowBounds,
            displayScaleFactor,
            devicePixelRatio,
            metrics: this.getMetrics(),
            qualityMode: this.qualityMode,
            startupDurations: this.getStartupDurations(),
            startupMarks: this.runtimeEvents.filter((entry) => entry.type.startsWith('startup_')).slice(-80),
            topSections: this.getTopSections(5),
            releaseGates: this.getReleaseGateSnapshot(),
            runtimeEvents: this.getRecentRuntimeEvents(60),
            themeSwitches: this.themeSwitches.slice(-20),
            gpu: {
                webglRenderer: (typeof window !== 'undefined' && window.activeGPURenderer)
                    || this.desktopGpuDiagnostics?.activeWebGLRenderer
                    || 'Unavailable',
                desktopDiagnostics: this.desktopGpuDiagnostics,
            },
            performancePolicy: this.desktopPerformancePolicy,
            extra,
        };
    }

    /**
     * Update memory metrics
     */
    updateMemoryMetrics() {
        if (!performance.memory) return;

        const memoryMB = performance.memory.usedJSHeapSize / (1024 * 1024);
        this.memoryHistory.push(memoryMB);
        if (this.memoryHistory.length > 60) { // Keep 1 minute of history
            this.memoryHistory.shift();
        }

        this.metrics.memoryUsed = memoryMB;
        this.metrics.memoryLimit = performance.memory.jsHeapSizeLimit / (1024 * 1024);
        this.metrics.memoryTotal = performance.memory.totalJSHeapSize / (1024 * 1024);
    }

    /**
     * Set the current quality mode for display
     */
    setQualityMode(mode) {
        this.qualityMode = mode || 'Unknown';
    }

    /**
     * Setup F3 keyboard toggle
     */
    setupKeyboardToggle() {
        if (this.boundKeyHandler) return;

        this.boundKeyHandler = (e) => {
            if (e.key === 'F3') {
                e.preventDefault();
                this.toggleOverlay();
            }
        };

        window.addEventListener('keydown', this.boundKeyHandler);
    }

    /**
     * Remove keyboard toggle listener
     */
    removeKeyboardToggle() {
        if (this.boundKeyHandler) {
            window.removeEventListener('keydown', this.boundKeyHandler);
            this.boundKeyHandler = null;
        }
    }

    /**
     * Begin tracking frames via requestAnimationFrame (or interval fallback)
     */
    startFrameListener() {
        if (this.frameListenerHandle || this.frameListenerInterval) return;

        if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
            const tick = () => {
                if (!this.enabled) {
                    this.stopFrameListener();
                    return;
                }
                this.frameStart();
                this.frameListenerHandle = window.requestAnimationFrame(tick);
            };

            this.frameListenerHandle = window.requestAnimationFrame(tick);
        } else {
            // Fallback for non-browser environments (tests, server-side rendering)
            this.frameListenerInterval = setInterval(() => {
                if (!this.enabled) {
                    this.stopFrameListener();
                    return;
                }
                this.frameStart();
            }, FRAME_BUDGET_MS);
        }
    }

    /**
     * Stop frame tracking loop
     */
    stopFrameListener() {
        if (this.frameListenerHandle && typeof window !== 'undefined'
            && typeof window.cancelAnimationFrame === 'function') {
            window.cancelAnimationFrame(this.frameListenerHandle);
        }
        this.frameListenerHandle = null;

        if (this.frameListenerInterval) {
            clearInterval(this.frameListenerInterval);
            this.frameListenerInterval = null;
        }
    }

    /**
     * Toggle overlay visibility
     */
    toggleOverlay() {
        if (this.showOverlay) {
            this.hidePerformanceOverlay();
        } else {
            this.showPerformanceOverlay();
        }
    }

    /**
     * Calculate average of an array
     */
    calculateAverage(arr) {
        if (arr.length === 0) return 0;
        return arr.reduce((sum, val) => sum + val, 0) / arr.length;
    }

    /**
     * Phase D.1: ingest renderer.info-style counters from the active theme.
     * Called once per frame after `renderer.render()`. Cheap — just stores the
     * last value and keeps a 60-sample rolling average for the volatile
     * counters (calls + triangles). Memory counters (geometries, textures,
     * programs) are stored as-is since they change slowly.
     */
    recordCounters({
        calls = 0,
        triangles = 0,
        geometries = 0,
        textures = 0,
        programs = 0,
    } = {}) {
        this.renderCounters.calls = calls;
        this.renderCounters.triangles = triangles;
        this.renderCounters.geometries = geometries;
        this.renderCounters.textures = textures;
        this.renderCounters.programs = programs;

        const samples = this._counterSamples;
        samples.calls.push(calls);
        if (samples.calls.length > SAMPLE_SIZE) samples.calls.shift();
        samples.triangles.push(triangles);
        if (samples.triangles.length > SAMPLE_SIZE) samples.triangles.shift();
        this.renderCounters.callsAvg = this.calculateAverage(samples.calls);
        this.renderCounters.trianglesAvg = this.calculateAverage(samples.triangles);
        // Wave -1 of docs/ODYSSEY_ONE_WORLD_PLAN_2026-08.md makes "median and p99, never mean"
        // an exit criterion for anything a decision is measured against. The rolling averages
        // above stay for the live overlay and the themes that read them; these are what the
        // COMMITTED perf report consumes, because a mean draw count over a journey that swings
        // between 40 and 260 draws describes no frame the game ever rendered.
        this.renderCounters.callsP50 = medianOf(samples.calls);
        this.renderCounters.callsMax = maxOf(samples.calls);
        this.renderCounters.trianglesP50 = medianOf(samples.triangles);
        this.renderCounters.trianglesMax = maxOf(samples.triangles);
    }

    /**
     * Phase J: register a function returning per-frame context to attach to
     * spike records. Themes set this to expose info like "GLB upgrades
     * pending", "bisect scenario name", etc. Called once per spike — keep
     * it cheap.
     */
    setSpikeContextCollector(fn) {
        this._spikeContextCollector = typeof fn === 'function' ? fn : null;
    }

    /**
     * Phase J: return the spike ring buffer (most-recent last). Each entry:
     *   { t, ms, fps, p50Before, ...themeContext }
     */
    getSpikes() {
        return this.spikes ? [...this.spikes] : [];
    }

    /**
     * Observe main-thread stalls: 'longtask' (>50ms tasks) plus
     * 'long-animation-frame' (LoAF, Chromium 123+) which carries script
     * attribution. Both are push-based — zero per-frame polling cost.
     */
    _initLongTaskObservers() {
        if (typeof PerformanceObserver === 'undefined') return;

        const record = (kind, entry) => {
            const ms = entry.duration;
            this.longTasks.count += 1;
            this.longTasks.totalMs += ms;
            if (ms > this.longTasks.maxMs) this.longTasks.maxMs = ms;
            const item = { kind, t: Math.round(entry.startTime), ms: Math.round(ms) };
            if (kind === 'loaf' && Array.isArray(entry.scripts) && entry.scripts.length > 0) {
                const top = entry.scripts[0];
                item.src = `${top.sourceURL || top.invoker || ''}`.slice(-80);
            }
            this.longTasks.recent.push(item);
            if (this.longTasks.recent.length > 100) this.longTasks.recent.shift();
        };

        try {
            this._longTaskObserver = new PerformanceObserver((list) => {
                list.getEntries().forEach((entry) => record('longtask', entry));
            });
            this._longTaskObserver.observe({ entryTypes: ['longtask'] });
        } catch (error) {
            this._longTaskObserver = null;
        }

        try {
            this._loafObserver = new PerformanceObserver((list) => {
                // LoAF duplicates longtask coverage for rendering-driven stalls but
                // adds script attribution; only record entries above the 50ms
                // longtask floor to keep counts comparable across browsers.
                list.getEntries().forEach((entry) => {
                    if (entry.duration >= 50) record('loaf', entry);
                });
            });
            this._loafObserver.observe({ type: 'long-animation-frame', buffered: false });
        } catch (error) {
            this._loafObserver = null;
        }
    }

    /**
     * Summary of observed main-thread stalls since startup.
     * @returns {{count:number,totalMs:number,maxMs:number,recent:Array}}
     */
    getLongTaskSummary() {
        return {
            count: this.longTasks.count,
            totalMs: Math.round(this.longTasks.totalMs),
            maxMs: Math.round(this.longTasks.maxMs),
            recent: [...this.longTasks.recent],
        };
    }

    clearSpikes() {
        this.spikes = [];
    }

    /**
     * Toggle the adaptive-downscale watchdog. Set to `true` while running
     * synthetic profiling (bisect) so the render scale doesn't drop
     * mid-measurement and skew per-scenario comparisons.
     */
    setAdaptiveDownscaleSuppressed(suppressed) {
        // Setting _hasEmittedDownscale=true short-circuits the watchdog at
        // performance-monitor.js:383; it stays true forever in normal
        // operation after the first fire, so this is safe to flip.
        this._hasEmittedDownscale = !!suppressed;
    }

    /**
     * Phase D.4: return frame-time percentiles so the overlay can show the
     * tail (p95/p99) — that's where "feels slow" actually lives.
     */
    getFrameTimePercentiles() {
        return {
            p50: this.calculatePercentile(this.frameTimes, 50),
            p95: this.calculatePercentile(this.frameTimes, 95),
            p99: this.calculatePercentile(this.frameTimes, 99),
        };
    }

    /**
     * Tail expressed as frame rates so it can sit beside the headline number.
     *
     * "1% low" is the rate implied by the 99th-percentile frame time — the
     * standard way to report stutter, and the honest replacement for the old
     * min/max-of-instantaneous-fps "range" (which reported things like
     * "0 - 833 fps" because a single 1.2ms sample became 833).
     *
     * @returns {{low1Pct:number, low5Pct:number}} fps
     */
    getLowFPS() {
        const p99 = this.calculatePercentile(this.frameTimes, 99);
        const p95 = this.calculatePercentile(this.frameTimes, 95);
        return {
            low1Pct: p99 > 0 ? 1000 / p99 : 0,
            low5Pct: p95 > 0 ? 1000 / p95 : 0,
        };
    }

    getFrameTimeSamples() {
        return [...this.frameTimeLog];
    }

    getFrameTimeSummary(targetFrameRate = 60) {
        const target = Number.isFinite(Number(targetFrameRate)) && Number(targetFrameRate) > 0
            ? Math.min(1000, Math.max(30, Number(targetFrameRate)))
            : 60;
        const budgetMs = 1000 / target;
        const sorted = this.frameTimeLog
            .filter((sample) => Number.isFinite(sample) && sample >= 0)
            .sort((a, b) => a - b);
        const count = sorted.length;
        if (count === 0) {
            return {
                count: 0,
                budgetMs,
                p50: 0,
                p95: 0,
                p99: 0,
                max: 0,
                overBudget: 0,
                overBudgetPct: 0,
            };
        }
        const percentile = (fraction) => {
            const index = Math.min(count - 1, Math.max(0, Math.round(fraction * (count - 1))));
            return sorted[index];
        };
        const overBudget = sorted.reduce((total, sample) => total + (sample > budgetMs ? 1 : 0), 0);
        return {
            count,
            budgetMs,
            p50: percentile(0.5),
            p95: percentile(0.95),
            p99: percentile(0.99),
            max: sorted[count - 1],
            overBudget,
            overBudgetPct: (overBudget / count) * 100,
        };
    }

    /**
     * Get current metrics
     */
    getMetrics() {
        return { ...this.metrics };
    }

    /**
     * Generate detailed performance report
     */
    generateReport() {
        const uptime = (performance.now() - this.startTime) / 1000;
        const frameDropRate = this.metrics.totalFrames > 0
            ? (this.metrics.frameDrops / this.metrics.totalFrames) * 100
            : 0;

        const report = {
            summary: {
                uptime: `${uptime.toFixed(2)}s`,
                totalFrames: this.metrics.totalFrames,
                frameDropRate: `${frameDropRate.toFixed(2)}%`,
            },
            fps: {
                current: this.metrics.fps.toFixed(1),
                // Throughput (1000 / mean frame time), not the mean of per-frame rates.
                average: this.metrics.avgFPS.toFixed(1),
                // The tail is what players feel; min/max of instantaneous rates was noise.
                low1Pct: this.getLowFPS().low1Pct.toFixed(1),
                low5Pct: this.getLowFPS().low5Pct.toFixed(1),
            },
            frameTime: {
                current: `${this.metrics.frameTime.toFixed(2)}ms`,
                average: `${this.metrics.avgFrameTime.toFixed(2)}ms`,
                max: `${this.metrics.maxFrameTime.toFixed(2)}ms`,
                budget: `${FRAME_BUDGET_MS.toFixed(2)}ms`,
            },
            performance: {
                updateTime: `${this.metrics.updateTime.toFixed(2)}ms`,
                renderTime: `${this.metrics.renderTime.toFixed(2)}ms`,
                inputLatency: `${this.metrics.inputLatency.toFixed(2)}ms`,
            },
            memory: {
                current: `${this.metrics.memoryUsed.toFixed(2)}MB`,
                history: this.memoryHistory.length > 0
                    ? `${Math.min(...this.memoryHistory).toFixed(2)}MB - ${Math.max(...this.memoryHistory).toFixed(2)}MB`
                    : 'N/A',
            },
            gpu: {
                webglRenderer: (typeof window !== 'undefined' && window.activeGPURenderer)
                    || this.desktopGpuDiagnostics?.activeWebGLRenderer
                    || 'Unavailable',
                desktopDiagnostics: this.desktopGpuDiagnostics,
            },
            performancePolicy: this.desktopPerformancePolicy,
        };

        console.group('📊 Performance Report');
        console.log('Summary:', report.summary);
        console.log('FPS:', report.fps);
        console.log('Frame Time:', report.frameTime);
        console.log('Performance:', report.performance);
        console.log('Memory:', report.memory);
        console.log('GPU:', report.gpu);
        console.groupEnd();

        return report;
    }

    /**
     * Create or update performance overlay UI
     */
    createOverlay() {
        if (this.overlayElement) return;

        const overlay = document.createElement('div');
        overlay.id = 'performance-overlay';
        overlay.style.cssText = `
            position: fixed;
            top: 15px;
            left: 15px;
            background: rgba(0, 0, 0, 0.9);
            color: #0f0;
            font-family: 'Courier New', monospace;
            font-size: 14px;
            padding: 16px;
            border-radius: 8px;
            z-index: 99999;
            pointer-events: none;
            min-width: 280px;
            box-shadow: 0 6px 16px rgba(0, 0, 0, 0.7);
            border: 2px solid rgba(0, 255, 0, 0.4);
        `;

        // Create canvas for frame time graph
        const canvas = document.createElement('canvas');
        canvas.width = GRAPH_WIDTH;
        canvas.height = GRAPH_HEIGHT;
        canvas.style.cssText = `
            display: block;
            margin-top: 8px;
            border: 1px solid rgba(0, 255, 0, 0.2);
            border-radius: 3px;
        `;

        overlay.appendChild(canvas);
        this.graphCanvas = canvas;
        this.graphContext = canvas.getContext('2d');

        document.body.appendChild(overlay);
        this.overlayElement = overlay;
    }

    /**
     * Show performance overlay
     */
    showPerformanceOverlay() {
        this.showOverlay = true;
        if (!this.enabled) {
            this.enable();
        }
        this.setSamplingReason('overlay', true);
        this.createOverlay();
        if (this.overlayElement) {
            this.overlayElement.style.display = 'block';
        }
        this.refreshDesktopGpuDiagnostics();
        this.startOverlayUpdates();
        this.updateOverlay();
    }

    /**
     * Hide performance overlay
     */
    hidePerformanceOverlay() {
        this.showOverlay = false;
        this.setSamplingReason('overlay', false);
        this.stopOverlayUpdates();
        if (this.overlayElement) {
            this.overlayElement.style.display = 'none';
        }
    }

    /**
     * Start automatic overlay updates using interval (not RAF to reduce overhead)
     * PERFORMANCE FIX: Using setInterval instead of RAF to avoid extra RAF loop
     */
    startOverlayUpdates() {
        if (this.overlayUpdateInterval) return;

        // Use setInterval instead of RAF - overlay doesn't need 60fps updates
        // Update every 250ms is sufficient for FPS display
        this.overlayUpdateInterval = setInterval(() => {
            if (!this.showOverlay) {
                this.stopOverlayUpdates();
                return;
            }
            this.updateOverlay();
        }, DISPLAY_UPDATE_INTERVAL);
    }

    /**
     * Stop automatic overlay updates
     */
    stopOverlayUpdates() {
        if (this.overlayUpdateInterval) {
            clearInterval(this.overlayUpdateInterval);
            this.overlayUpdateInterval = null;
        }
    }

    /**
     * Draw frame time graph
     */
    drawFrameTimeGraph() {
        if (!this.graphContext) return;

        const ctx = this.graphContext;
        const width = GRAPH_WIDTH;
        const height = GRAPH_HEIGHT;

        // Clear canvas
        ctx.fillStyle = 'rgba(0, 0, 0, 0.9)';
        ctx.fillRect(0, 0, width, height);

        // Draw budget line (16.67ms for 60fps)
        const budgetY = height - (FRAME_BUDGET_MS / 33.33) * height; // Scale to 33ms max
        ctx.strokeStyle = 'rgba(255, 255, 0, 0.5)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, budgetY);
        ctx.lineTo(width, budgetY);
        ctx.stroke();

        // Draw frame time graph
        if (this.frameTimes.length > 1) {
            const pointSpacing = width / SAMPLE_SIZE;

            ctx.lineWidth = 1.5;
            ctx.beginPath();

            for (let i = 0; i < this.frameTimes.length; i++) {
                const frameTime = Math.min(this.frameTimes[i], 33.33); // Cap at 33ms for display
                const x = i * pointSpacing;
                const y = height - (frameTime / 33.33) * height;

                // Color based on performance
                const isGood = this.frameTimes[i] <= FRAME_BUDGET_MS;
                const isOk = this.frameTimes[i] <= 20;
                ctx.strokeStyle = isGood ? '#0f0' : isOk ? '#ff0' : '#f00';

                if (i === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            }

            ctx.stroke();
        }

        // Draw grid lines
        ctx.strokeStyle = 'rgba(0, 255, 0, 0.1)';
        ctx.lineWidth = 0.5;
        for (let i = 0; i <= 4; i++) {
            const y = (height / 4) * i;
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            ctx.stroke();
        }
    }

    /**
     * Update overlay display
     * Throttled to prevent flickering and make numbers more readable
     */
    updateOverlay() {
        if (!this.showOverlay || !this.overlayElement) return;

        const now = performance.now();

        // Throttle display updates to every 500ms for stability
        if (now - this.lastDisplayUpdate < DISPLAY_UPDATE_INTERVAL && this.displayMetricsCache) {
            // Use cached metrics for stable display
            this.renderOverlay(this.displayMetricsCache);
            return;
        }

        this.lastDisplayUpdate = now;

        // Calculate stable metrics (use averages for stability)
        const stableFPS = this.metrics.avgFPS || this.metrics.fps;
        const stableFrameTime = this.metrics.avgFrameTime || this.metrics.frameTime;
        const safeFPS = Number.isFinite(stableFPS) ? stableFPS : 0;
        const safeFrameTime = Number.isFinite(stableFrameTime) ? stableFrameTime : 0;
        const lows = this.getLowFPS();
        const low1Pct = Number.isFinite(lows.low1Pct) ? lows.low1Pct : safeFPS;
        const low5Pct = Number.isFinite(lows.low5Pct) ? lows.low5Pct : safeFPS;
        let low1PctColor = '#f00';
        if (low1Pct >= 55) low1PctColor = '#0f0';
        else if (low1Pct >= 30) low1PctColor = '#ff0';
        const memoryUsed = Number.isFinite(this.metrics.memoryUsed) ? this.metrics.memoryUsed : 0;
        const memoryLimit = Number.isFinite(this.metrics.memoryLimit) && this.metrics.memoryLimit > 0
            ? this.metrics.memoryLimit
            : null;
        const memoryPercent = memoryLimit ? Math.min((memoryUsed / memoryLimit) * 100, 100) : null;

        // Color coding based on performance
        const fpsColor = safeFPS >= 55 ? '#0f0' : safeFPS >= 45 ? '#ff0' : '#f00';
        const frameTimeColor = safeFrameTime <= FRAME_BUDGET_MS ? '#0f0' : safeFrameTime <= 20 ? '#ff0' : '#f00';
        const memoryColor = memoryPercent === null
            ? '#0f0'
            : memoryPercent < 50 ? '#0f0' : memoryPercent < 75 ? '#ff0' : '#f00';

        // Calculate uptime
        const uptime = ((now - this.startTime) / 1000).toFixed(0);
        const hotSections = this.getTopSections(3);

        // Cache stable metrics for smooth display
        const percentiles = this.getFrameTimePercentiles();
        this.displayMetricsCache = {
            fps: safeFPS,
            frameTime: safeFrameTime,
            fpsColor,
            frameTimeColor,
            memoryColor,
            memoryPercent,
            uptime,
            low1Pct,
            low5Pct,
            low1PctColor,
            memoryUsed,
            memoryLimit,
            frameDrops: Number.isFinite(this.metrics.frameDrops) ? this.metrics.frameDrops : 0,
            drawCalls: typeof window !== 'undefined' ? resolveActiveThemeDrawCalls(window) : 0,
            hotSections,
            collectionMode: this.collectionMode,
            themeSwitchCount: this.metrics.themeSwitchCount,
            contextRestoreCount: this.metrics.contextRestoreCount,
            // Phase D.1 + D.4: real renderer.info counters + tail percentiles.
            counters: { ...this.renderCounters },
            percentiles,
        };

        this.renderOverlay(this.displayMetricsCache);
    }

    /**
     * Render the overlay with given metrics
     * Separated for throttled updates
     */
    renderOverlay(displayMetrics) {
        if (!this.overlayElement) return;

        this.overlayElement.style.display = 'block';
        const webglRenderer = (typeof window !== 'undefined' && window.activeGPURenderer)
            || this.desktopGpuDiagnostics?.activeWebGLRenderer
            || '';
        const desktopGpuInfo = this.getDesktopGpuOverlayInfo();

        // Build HTML content with larger, more readable fonts
        const hotSections = displayMetrics.hotSections || [];
        const metricsHTML = `
            <div style="margin-bottom: 10px; border-bottom: 2px solid rgba(0,255,0,0.3); padding-bottom: 6px;">
                <strong style="color: #0ff; font-size: 16px;">⚡ Performance</strong>
                <span style="color: #888; font-size: 11px; float: right;">F3</span>
            </div>
            <div style="color: #888; font-size: 11px; margin-bottom: 8px;">
                Quality: <span style="color: #0ff; font-weight: bold;">${this.qualityMode}</span>
            </div>
            <div style="color: #888; font-size: 11px; margin-bottom: 8px;">
                Mode: <span style="color: #0ff; font-weight: bold;">${displayMetrics.collectionMode}</span>
            </div>
            ${webglRenderer ? `
            <div style="color: #888; font-size: 11px; margin-bottom: 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 250px;" title="${escapeAttribute(webglRenderer)}">
                WebGL: <span style="color: #0f0;">${escapeHtml(simplifyGPUName(webglRenderer))}</span>
            </div>` : ''}
            ${desktopGpuInfo?.adapterLabel ? `
            <div style="color: #888; font-size: 11px; margin-bottom: 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 250px;" title="${escapeAttribute(desktopGpuInfo.adapterTitle)}">
                Desktop: <span style="color: #0ff;">${escapeHtml(desktopGpuInfo.adapterLabel)}</span>
            </div>` : ''}
            ${desktopGpuInfo?.featureSummary ? `
            <div style="color: #888; font-size: 10px; margin-bottom: 8px; line-height: 1.4;" title="${escapeAttribute(desktopGpuInfo.switchSummary)}">
                GPU Status: <span style="color: #8ff;">${escapeHtml(desktopGpuInfo.featureSummary)}</span>
            </div>` : ''}
            ${desktopGpuInfo?.healthSummary || desktopGpuInfo?.angleBackend ? `
            <div style="color: #888; font-size: 10px; margin-bottom: 8px; line-height: 1.4;">
                ${desktopGpuInfo.healthSummary ? `<span style="color: #ffd166;">${escapeHtml(desktopGpuInfo.healthSummary)}</span>` : ''}
                ${desktopGpuInfo.angleBackend ? `<span style="color: #8ff;"> · ANGLE: ${escapeHtml(desktopGpuInfo.angleBackend)}</span>` : ''}
            </div>` : ''}

            <div style="color: ${displayMetrics.fpsColor}; font-weight: bold; font-size: 24px; margin: 8px 0;">
                ${displayMetrics.fps.toFixed(1)} <span style="font-size: 14px;">FPS</span>
            </div>
            <div style="font-size: 12px; margin-bottom: 8px;">
                <span style="color: #888;">1% low</span>
                <span style="color: ${displayMetrics.low1PctColor}; font-weight: bold;">${displayMetrics.low1Pct.toFixed(0)}</span>
                <span style="color: #888;">· 5% low ${displayMetrics.low5Pct.toFixed(0)} fps</span>
            </div>
            <div style="margin-top: 8px; color: ${displayMetrics.frameTimeColor}; font-size: 13px;">
                Frame: ${displayMetrics.frameTime.toFixed(1)}ms / ${FRAME_BUDGET_MS.toFixed(1)}ms
            </div>
            ${displayMetrics.memoryUsed > 0 ? `
                <div style="margin-top: 10px; padding-top: 8px; border-top: 1px solid rgba(0,255,0,0.1);">
                    <div style="color: ${displayMetrics.memoryColor}; font-size: 13px;">
                        Memory: ${displayMetrics.memoryUsed.toFixed(0)} MB
                    </div>
                    ${displayMetrics.memoryLimit ? `
                        <div style="color: #888; font-size: 11px;">
                            ${displayMetrics.memoryPercent.toFixed(0)}% of ${displayMetrics.memoryLimit.toFixed(0)} MB
                        </div>
                    ` : `
                        <div style="color: #888; font-size: 11px;">
                            Memory limit unavailable
                        </div>
                    `}
                </div>
            ` : ''}
            <div style="margin-top: 10px; color: #888; font-size: 11px; padding-top: 8px; border-top: 1px solid rgba(0,255,0,0.1);">
                Drops: <span style="color: ${displayMetrics.frameDrops > 0 ? '#f00' : '#0f0'}">${displayMetrics.frameDrops}</span>
                · Theme+shared draws: <span style="color: #0ff">${displayMetrics.drawCalls}</span>
                · Uptime: ${displayMetrics.uptime}s
                <br />Themes: <span style="color: #0ff">${displayMetrics.themeSwitchCount}</span>
                · Restores: <span style="color: #0ff">${displayMetrics.contextRestoreCount}</span>
            </div>
            ${typeof window !== 'undefined' && window.__oceanBisectStatus ? `
                <div style="margin-top: 10px; color: #fff; font-size: 11px; padding-top: 8px; border-top: 1px solid rgba(255, 200, 0, 0.4); background: rgba(255, 165, 0, 0.12); padding: 8px; border-radius: 4px;">
                    <strong style="color: #ffa500;">🔬 Bisect running (${window.__oceanBisectStatus.scope})</strong>
                    <br />${window.__oceanBisectStatus.idx} / ${window.__oceanBisectStatus.total} · ETA ${window.__oceanBisectStatus.etaSec}s
                    <br /><span style="color: #ffd; font-size: 10px;">${window.__oceanBisectStatus.name}</span>
                </div>
            ` : ''}
            ${displayMetrics.percentiles && displayMetrics.percentiles.p50 > 0 ? `
                <div style="margin-top: 10px; color: #888; font-size: 11px; padding-top: 8px; border-top: 1px solid rgba(0,255,0,0.1);">
                    <strong style="color: #0ff;">Frame Time Tail</strong>
                    <br />p50: <span style="color: ${displayMetrics.percentiles.p50 <= FRAME_BUDGET_MS ? '#0f0' : '#ff0'}">${displayMetrics.percentiles.p50.toFixed(1)}ms</span>
                    · p95: <span style="color: ${displayMetrics.percentiles.p95 <= 20 ? '#0f0' : displayMetrics.percentiles.p95 <= 33 ? '#ff0' : '#f00'}">${displayMetrics.percentiles.p95.toFixed(1)}ms</span>
                    · p99: <span style="color: ${displayMetrics.percentiles.p99 <= 33 ? '#ff0' : '#f00'}">${displayMetrics.percentiles.p99.toFixed(1)}ms</span>
                    ${this.spikes && this.spikes.length > 0 ? `
                        <br /><span style="color: #f80;">Spikes(>33ms): ${this.spikes.length}</span>
                        · last: <span style="color: #fa0;">${this.spikes[this.spikes.length - 1].ms.toFixed(0)}ms</span>
                        <span style="color: #666; font-size: 10px;">→ window.perfMonitor.getSpikes()</span>
                    ` : ''}
                </div>
            ` : ''}
            ${displayMetrics.counters && (displayMetrics.counters.callsAvg > 0 || displayMetrics.counters.geometries > 0) ? `
                <div style="margin-top: 10px; color: #888; font-size: 11px; padding-top: 8px; border-top: 1px solid rgba(0,255,0,0.1);">
                    <strong style="color: #0ff;">renderer.info</strong>
                    <br />Calls: <span style="color: ${displayMetrics.counters.callsAvg > 300 ? '#f00' : displayMetrics.counters.callsAvg > 150 ? '#ff0' : '#0f0'}">${displayMetrics.counters.callsAvg.toFixed(0)}</span>
                    · Tris: <span style="color: ${displayMetrics.counters.trianglesAvg > 3_000_000 ? '#f00' : displayMetrics.counters.trianglesAvg > 1_500_000 ? '#ff0' : '#0f0'}">${(displayMetrics.counters.trianglesAvg / 1000).toFixed(0)}k</span>
                    <br />Geoms: <span style="color: #0ff">${displayMetrics.counters.geometries}</span>
                    · Texs: <span style="color: #0ff">${displayMetrics.counters.textures}</span>
                    · Progs: <span style="color: ${displayMetrics.counters.programs > 80 ? '#ff0' : '#0ff'}">${displayMetrics.counters.programs}</span>
                </div>
            ` : ''}
            <div style="margin-top: 8px; color: #888; font-size: 10px;">
                Frame Time (60 frames)
            </div>
            ${hotSections.length ? `
                <div style="margin-top: 10px; color: #888; font-size: 10px; padding-top: 8px; border-top: 1px solid rgba(0,255,0,0.1);">
                    Hot Sections:
                    ${hotSections.map((section) => {
        const color = section.avg >= 10 ? '#f00' : section.avg >= 6 ? '#ff0' : '#0f0';
        return `
                            <div style="color: ${color}; margin-top: 2px;">
                                ${section.name}: ${section.avg.toFixed(1)}ms avg (${section.last.toFixed(1)}ms last)
                            </div>
                        `;
    }).join('')}
                </div>
            ` : ''}
        `;

        // Update content (preserve canvas)
        const canvas = this.graphCanvas;
        this.overlayElement.innerHTML = metricsHTML;
        if (canvas && canvas.parentElement !== this.overlayElement) {
            this.overlayElement.appendChild(canvas);
        }

        // Draw the graph (only when actually updating)
        this.drawFrameTimeGraph();
    }

    /**
     * Export metrics to JSON for analysis
     */
    exportMetrics() {
        const data = {
            timestamp: new Date().toISOString(),
            metrics: this.metrics,
            frameTimes: [...this.frameTimes],
            fpsHistory: [...this.fpsHistory],
            inputLatencyHistory: [...this.inputLatencyHistory],
            memoryHistory: [...this.memoryHistory],
            releaseGates: this.getReleaseGateSnapshot(),
            runtimeEvents: [...this.runtimeEvents],
            themeSwitches: [...this.themeSwitches],
            network: this.latestNetworkStats,
            gpu: {
                webglRenderer: (typeof window !== 'undefined' && window.activeGPURenderer)
                    || this.desktopGpuDiagnostics?.activeWebGLRenderer
                    || null,
                desktopDiagnostics: this.desktopGpuDiagnostics,
            },
        };

        const json = JSON.stringify(data, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = `performance-${Date.now()}.json`;
        a.click();

        URL.revokeObjectURL(url);
        console.log('[PerformanceMonitor] Metrics exported');
    }
}

// Singleton instance
export const performanceMonitor = new PerformanceMonitor();

// Expose to window for debugging
if (typeof window !== 'undefined') {
    window.perfMonitor = {
        start: () => {
            performanceMonitor.enable({ samplingReason: 'manual' });
            performanceMonitor.showPerformanceOverlay();
            console.log('✅ Performance monitoring started (Press F3 to toggle)');
        },
        stop: () => {
            performanceMonitor.disable();
            performanceMonitor.hidePerformanceOverlay();
            console.log('⏹️ Performance monitoring stopped');
        },
        show: () => {
            performanceMonitor.showPerformanceOverlay();
        },
        hide: () => {
            performanceMonitor.hidePerformanceOverlay();
        },
        toggle: () => {
            performanceMonitor.toggleOverlay();
        },
        setQuality: (mode) => {
            performanceMonitor.setQualityMode(mode);
            console.log(`🎨 Quality mode set to: ${mode}`);
        },
        report: () => performanceMonitor.generateReport(),
        reset: () => {
            performanceMonitor.reset();
            console.log('🔄 Metrics reset');
        },
        export: () => {
            performanceMonitor.exportMetrics();
        },
        getMetrics: () => performanceMonitor.getMetrics(),
        gates: () => performanceMonitor.getReleaseGateSnapshot(),
        event: (type, payload) => performanceMonitor.recordEvent(type, payload),
        // Section profiling — exposed so themes can wrap subsystem work with
        // startSection/endSection and the overlay's top-3 hot list will pick
        // them up. No-ops when monitoring is disabled.
        startSection: (name) => performanceMonitor.startSection(name),
        // Phase D.1: themes push renderer.info counters once per frame so the
        // overlay shows true draw call / triangle counts (not just JS time).
        recordCounters: (counters) => performanceMonitor.recordCounters(counters),
        getCounters: () => ({ ...performanceMonitor.renderCounters }),
        getPercentiles: () => performanceMonitor.getFrameTimePercentiles(),
        // Throughput + tail as frame rates. Prefer these over the raw `fps`
        // metric when eyeballing smoothness — see
        // docs/GAMEPLAY_SMOOTHNESS_INVESTIGATION_2026-08.md §1.
        getLowFPS: () => performanceMonitor.getLowFPS(),
        getFrameTimes: () => performanceMonitor.getFrameTimeSamples(),
        getFrameTimeSummary: (targetFrameRate) => performanceMonitor.getFrameTimeSummary(targetFrameRate),
        setAdaptiveDownscaleSuppressed: (b) => performanceMonitor.setAdaptiveDownscaleSuppressed(b),
        // Phase J: spike logger surfacing.
        setSpikeContextCollector: (fn) => performanceMonitor.setSpikeContextCollector(fn),
        getSpikes: () => performanceMonitor.getSpikes(),
        clearSpikes: () => performanceMonitor.clearSpikes(),
        // SB-09: main-thread stall attribution (longtask + long-animation-frame).
        getLongTaskSummary: () => performanceMonitor.getLongTaskSummary(),
        getAllSections: () => {
            const out = {};
            performanceMonitor.sectionMetrics.forEach((m, name) => {
                out[name] = { avg: m.avg, max: m.max, last: m.last };
            });
            return out;
        },
        endSection: (name) => performanceMonitor.endSection(name),
        getTopSections: (limit) => performanceMonitor.getTopSections(limit),
    };

    console.log('💡 Performance monitor available:');
    console.log('  window.perfMonitor.start()  - Start monitoring with overlay');
    console.log('  window.perfMonitor.stop()   - Stop monitoring');
    console.log('  window.perfMonitor.toggle() - Toggle overlay (or press F3)');
    console.log('  window.perfMonitor.setQuality(mode) - Set quality mode display');
    console.log('  window.perfMonitor.report() - Generate detailed report');
    console.log('  window.perfMonitor.export() - Export metrics to JSON');
}
