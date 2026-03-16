/**
 * @fileoverview Performance monitoring and profiling utilities
 * Tracks FPS, frame time, input latency, memory usage, and other metrics
 */

import { eventBus, EVENTS } from '../events/event-bus.js';

const FRAME_BUDGET_MS = 16.67; // 60fps target
const SAMPLE_SIZE = 60; // 1 second worth of samples at 60fps
const MEMORY_CHECK_INTERVAL = 1000; // Check memory every second
const DISPLAY_UPDATE_INTERVAL = 500; // Update display every 500ms for stability
const GRAPH_WIDTH = 240; // Width of frame time graph in pixels
const GRAPH_HEIGHT = 50; // Height of frame time graph in pixels
const SECTION_SAMPLE_SIZE = 90;

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

        // Quality mode tracking
        this.qualityMode = 'Unknown';

        // Keyboard toggle listener
        this.boundKeyHandler = null;

        // Display update throttling
        this.lastDisplayUpdate = 0;
        this.displayMetricsCache = null;
        this.collectionMode = 'disabled';
        this.runtimeEvents = [];
        this.themeSwitches = [];
        this.latestNetworkStats = null;
        this.eventUnsubscribers = [];
        this.desktopGpuDiagnostics = null;
        this.desktopGpuRefreshPromise = null;

        console.log('[PerformanceMonitor] Initialized');
    }

    /**
     * Enable performance monitoring
     */
    enable() {
        if (this.enabled) return;

        this.enabled = true;
        this.collectionMode = this.showOverlay ? 'collecting_with_overlay' : 'collecting';

        // Reset metrics
        this.reset();

        // Start memory monitoring
        if (performance.memory) {
            this.memoryInterval = setInterval(() => {
                this.updateMemoryMetrics();
            }, MEMORY_CHECK_INTERVAL);
        }

        // Setup F3 toggle hotkey
        this.setupKeyboardToggle();
        this.startFrameListener();
        this.bindRuntimeEvents();
        this.refreshDesktopGpuDiagnostics();

        console.log('[PerformanceMonitor] Enabled');
    }

    /**
     * Disable performance monitoring
     */
    disable() {
        if (!this.enabled) return;

        this.enabled = false;
        this.collectionMode = 'disabled';

        // Stop memory monitoring
        if (this.memoryInterval) {
            clearInterval(this.memoryInterval);
            this.memoryInterval = null;
        }

        // Remove keyboard listener
        this.removeKeyboardToggle();
        this.stopFrameListener();
        this.stopOverlayUpdates();
        this.unbindRuntimeEvents();

        console.log('[PerformanceMonitor] Disabled');
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
        this.fpsHistory = [];
        this.inputLatencyHistory = [];
        this.memoryHistory = [];
        this.runtimeEvents = [];
        this.themeSwitches = [];
        this.latestNetworkStats = null;
        this.sectionTimers.clear();
        this.sectionMetrics.clear();

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

        // Calculate averages
        this.metrics.avgFPS = this.calculateAverage(this.fpsHistory);
        this.metrics.avgFrameTime = this.calculateAverage(this.frameTimes);

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
            updatedAt: diagnostics.updatedAt || null,
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

        return {
            adapterLabel,
            adapterTitle,
            featureSummary,
            switchSummary,
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
        extra = {},
    } = {}) {
        return {
            generatedAt: new Date().toISOString(),
            stage,
            appMode,
            runtimeConfig,
            settingsSnapshot,
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
                average: this.metrics.avgFPS.toFixed(1),
                min: this.metrics.minFPS.toFixed(1),
                max: this.metrics.maxFPS.toFixed(1),
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
        this.collectionMode = this.enabled ? 'collecting_with_overlay' : 'disabled';
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
        this.collectionMode = this.enabled ? 'collecting' : 'disabled';
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
        const minFPS = Number.isFinite(this.metrics.minFPS) && this.metrics.minFPS !== Infinity
            ? this.metrics.minFPS
            : safeFPS;
        const maxFPS = Number.isFinite(this.metrics.maxFPS) ? this.metrics.maxFPS : safeFPS;
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
        this.displayMetricsCache = {
            fps: safeFPS,
            frameTime: safeFrameTime,
            fpsColor,
            frameTimeColor,
            memoryColor,
            memoryPercent,
            uptime,
            minFPS,
            maxFPS,
            memoryUsed,
            memoryLimit,
            frameDrops: Number.isFinite(this.metrics.frameDrops) ? this.metrics.frameDrops : 0,
            drawCalls: typeof window !== 'undefined' ? window.activeDrawCalls || 0 : 0,
            hotSections,
            collectionMode: this.collectionMode,
            themeSwitchCount: this.metrics.themeSwitchCount,
            contextRestoreCount: this.metrics.contextRestoreCount,
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
                WebGL: <span style="color: #0f0;">${simplifyGPUName(webglRenderer)}</span>
            </div>` : ''}
            ${desktopGpuInfo?.adapterLabel ? `
            <div style="color: #888; font-size: 11px; margin-bottom: 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 250px;" title="${escapeAttribute(desktopGpuInfo.adapterTitle)}">
                Desktop: <span style="color: #0ff;">${desktopGpuInfo.adapterLabel}</span>
            </div>` : ''}
            ${desktopGpuInfo?.featureSummary ? `
            <div style="color: #888; font-size: 10px; margin-bottom: 8px; line-height: 1.4;" title="${escapeAttribute(desktopGpuInfo.switchSummary)}">
                GPU Status: <span style="color: #8ff;">${desktopGpuInfo.featureSummary}</span>
            </div>` : ''}

            <div style="color: ${displayMetrics.fpsColor}; font-weight: bold; font-size: 24px; margin: 8px 0;">
                ${displayMetrics.fps.toFixed(1)} <span style="font-size: 14px;">FPS</span>
            </div>
            <div style="color: #888; font-size: 12px; margin-bottom: 8px;">
                ${displayMetrics.minFPS.toFixed(0)} - ${displayMetrics.maxFPS.toFixed(0)} fps range
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
                · Draws: <span style="color: #0ff">${displayMetrics.drawCalls}</span>
                · Uptime: ${displayMetrics.uptime}s
                <br />Themes: <span style="color: #0ff">${displayMetrics.themeSwitchCount}</span>
                · Restores: <span style="color: #0ff">${displayMetrics.contextRestoreCount}</span>
            </div>
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
            performanceMonitor.enable();
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
    };

    console.log('💡 Performance monitor available:');
    console.log('  window.perfMonitor.start()  - Start monitoring with overlay');
    console.log('  window.perfMonitor.stop()   - Stop monitoring');
    console.log('  window.perfMonitor.toggle() - Toggle overlay (or press F3)');
    console.log('  window.perfMonitor.setQuality(mode) - Set quality mode display');
    console.log('  window.perfMonitor.report() - Generate detailed report');
    console.log('  window.perfMonitor.export() - Export metrics to JSON');
}
