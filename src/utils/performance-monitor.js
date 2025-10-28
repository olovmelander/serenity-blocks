/**
 * @fileoverview Performance monitoring and profiling utilities
 * Tracks FPS, frame time, input latency, memory usage, and other metrics
 */

const FRAME_BUDGET_MS = 16.67; // 60fps target
const SAMPLE_SIZE = 60; // 1 second worth of samples at 60fps
const MEMORY_CHECK_INTERVAL = 1000; // Check memory every second

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
        };

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

        console.log('[PerformanceMonitor] Initialized');
    }

    /**
     * Enable performance monitoring
     */
    enable() {
        if (this.enabled) return;

        this.enabled = true;
        this.startTime = performance.now();
        this.lastFrameTime = this.startTime;

        // Reset metrics
        this.reset();

        // Start memory monitoring
        if (performance.memory) {
            this.memoryInterval = setInterval(() => {
                this.updateMemoryMetrics();
            }, MEMORY_CHECK_INTERVAL);
        }

        console.log('[PerformanceMonitor] Enabled');
    }

    /**
     * Disable performance monitoring
     */
    disable() {
        if (!this.enabled) return;

        this.enabled = false;

        // Stop memory monitoring
        if (this.memoryInterval) {
            clearInterval(this.memoryInterval);
            this.memoryInterval = null;
        }

        console.log('[PerformanceMonitor] Disabled');
    }

    /**
     * Reset all metrics
     */
    reset() {
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
        };

        this.frameTimes = [];
        this.fpsHistory = [];
        this.inputLatencyHistory = [];
        this.memoryHistory = [];

        console.log('[PerformanceMonitor] Metrics reset');
    }

    /**
     * Mark the start of a frame
     */
    frameStart() {
        if (!this.enabled) return;

        const now = performance.now();
        const frameTime = now - this.lastFrameTime;

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
        const frameDropRate = (this.metrics.frameDrops / this.metrics.totalFrames) * 100;

        const report = {
            summary: {
                uptime: uptime.toFixed(2) + 's',
                totalFrames: this.metrics.totalFrames,
                frameDropRate: frameDropRate.toFixed(2) + '%',
            },
            fps: {
                current: this.metrics.fps.toFixed(1),
                average: this.metrics.avgFPS.toFixed(1),
                min: this.metrics.minFPS.toFixed(1),
                max: this.metrics.maxFPS.toFixed(1),
            },
            frameTime: {
                current: this.metrics.frameTime.toFixed(2) + 'ms',
                average: this.metrics.avgFrameTime.toFixed(2) + 'ms',
                max: this.metrics.maxFrameTime.toFixed(2) + 'ms',
                budget: FRAME_BUDGET_MS.toFixed(2) + 'ms',
            },
            performance: {
                updateTime: this.metrics.updateTime.toFixed(2) + 'ms',
                renderTime: this.metrics.renderTime.toFixed(2) + 'ms',
                inputLatency: this.metrics.inputLatency.toFixed(2) + 'ms',
            },
            memory: {
                current: this.metrics.memoryUsed.toFixed(2) + 'MB',
                history: this.memoryHistory.length > 0
                    ? `${Math.min(...this.memoryHistory).toFixed(2)}MB - ${Math.max(...this.memoryHistory).toFixed(2)}MB`
                    : 'N/A',
            },
        };

        console.group('📊 Performance Report');
        console.log('Summary:', report.summary);
        console.log('FPS:', report.fps);
        console.log('Frame Time:', report.frameTime);
        console.log('Performance:', report.performance);
        console.log('Memory:', report.memory);
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
            top: 10px;
            right: 10px;
            background: rgba(0, 0, 0, 0.8);
            color: #0f0;
            font-family: monospace;
            font-size: 12px;
            padding: 10px;
            border-radius: 5px;
            z-index: 10000;
            pointer-events: none;
            min-width: 200px;
        `;

        document.body.appendChild(overlay);
        this.overlayElement = overlay;
    }

    /**
     * Show performance overlay
     */
    showPerformanceOverlay() {
        this.showOverlay = true;
        this.createOverlay();
        this.updateOverlay();
    }

    /**
     * Hide performance overlay
     */
    hidePerformanceOverlay() {
        this.showOverlay = false;
        if (this.overlayElement) {
            this.overlayElement.style.display = 'none';
        }
    }

    /**
     * Update overlay display
     */
    updateOverlay() {
        if (!this.showOverlay || !this.overlayElement) return;

        this.overlayElement.style.display = 'block';

        const fpsColor = this.metrics.fps >= 55 ? '#0f0' : this.metrics.fps >= 45 ? '#ff0' : '#f00';
        const frameTimeColor = this.metrics.frameTime <= FRAME_BUDGET_MS ? '#0f0' : this.metrics.frameTime <= 20 ? '#ff0' : '#f00';

        this.overlayElement.innerHTML = `
            <div><strong>Performance Monitor</strong></div>
            <div style="color: ${fpsColor}">FPS: ${this.metrics.fps.toFixed(1)} (avg: ${this.metrics.avgFPS.toFixed(1)})</div>
            <div style="color: ${frameTimeColor}">Frame: ${this.metrics.frameTime.toFixed(2)}ms / ${FRAME_BUDGET_MS}ms</div>
            <div>Update: ${this.metrics.updateTime.toFixed(2)}ms</div>
            <div>Render: ${this.metrics.renderTime.toFixed(2)}ms</div>
            <div>Input: ${this.metrics.inputLatency.toFixed(2)}ms</div>
            <div>Drops: ${this.metrics.frameDrops}</div>
            ${this.metrics.memoryUsed > 0 ? `<div>Memory: ${this.metrics.memoryUsed.toFixed(2)}MB</div>` : ''}
        `;
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
            console.log('✅ Performance monitoring started');
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
        report: () => {
            return performanceMonitor.generateReport();
        },
        reset: () => {
            performanceMonitor.reset();
            console.log('🔄 Metrics reset');
        },
        export: () => {
            performanceMonitor.exportMetrics();
        },
        getMetrics: () => {
            return performanceMonitor.getMetrics();
        },
    };

    console.log('💡 Performance monitor available:');
    console.log('  window.perfMonitor.start()  - Start monitoring with overlay');
    console.log('  window.perfMonitor.stop()   - Stop monitoring');
    console.log('  window.perfMonitor.report() - Generate detailed report');
    console.log('  window.perfMonitor.export() - Export metrics to JSON');
}
