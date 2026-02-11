/**
 * @fileoverview FrameRateController - manages FPS limiting, VSync state, and statistics.
 * Provides hybrid loop support for high FPS targets that exceed monitor refresh rate.
 * Uses setTimeout for game logic updates and requestAnimationFrame for rendering.
 */

export class FrameRateController {
    constructor() {
        this.targetFPS = 60;
        this.vsyncEnabled = true;
        this.monitorRefreshRate = 60; // Assumed default, will be detected

        this.frameInterval = this.targetFPS > 0 ? 1000 / this.targetFPS : 0;
        this.lastFrameTime = performance.now();
        this.lastProcessedTime = this.lastFrameTime;

        this.lastStatsUpdate = this.lastFrameTime;
        this.frameCount = 0;
        this.actualFPS = 0;
        this.fpsHistory = [];
        this.maxFPSHistory = 120;

        // Hybrid loop state
        this.isRunning = false;
        this.logicTimeoutId = null;
        this.renderAnimationId = null;
        this.lastLogicTime = 0;
        this.lastRenderTime = 0;
        this.accumulator = 0;
        this.logicUpdatesPerSecond = 0;
        this.lastLogicStatsUpdate = 0;
        this.logicUpdateCount = 0;

        // Callbacks
        this.updateCallback = null;
        this.renderCallback = null;

        // Detect monitor refresh rate
        this._detectMonitorRefreshRate();
    }

    /**
     * Attempt to detect the monitor's refresh rate
     * @private
     */
    _detectMonitorRefreshRate() {
        if (typeof window === 'undefined') return;

        let frameCount = 0;
        let startTime = 0;
        const sampleFrames = 20;

        const measureFrame = (timestamp) => {
            if (frameCount === 0) {
                startTime = timestamp;
            }
            frameCount++;

            if (frameCount >= sampleFrames) {
                const elapsed = timestamp - startTime;
                const measuredRate = Math.round((frameCount * 1000) / elapsed);
                // Round to common refresh rates
                if (measuredRate >= 110 && measuredRate <= 130) {
                    this.monitorRefreshRate = 120;
                } else if (measuredRate >= 135 && measuredRate <= 150) {
                    this.monitorRefreshRate = 144;
                } else if (measuredRate >= 155 && measuredRate <= 170) {
                    this.monitorRefreshRate = 165;
                } else if (measuredRate >= 230 && measuredRate <= 250) {
                    this.monitorRefreshRate = 240;
                } else if (measuredRate >= 55 && measuredRate <= 65) {
                    this.monitorRefreshRate = 60;
                } else if (measuredRate < 30) {
                    this.monitorRefreshRate = 60;
                    console.log(`[FrameRate] Refresh-rate sample (${measuredRate}Hz) looked throttled. Using 60Hz fallback.`);
                } else {
                    this.monitorRefreshRate = measuredRate;
                }
                console.log(`[FrameRate] Detected monitor refresh rate: ${this.monitorRefreshRate}Hz (measured: ${measuredRate})`);
                return;
            }
            requestAnimationFrame(measureFrame);
        };

        requestAnimationFrame(measureFrame);
    }

    /**
     * Check if hybrid mode is needed (target FPS exceeds monitor rate)
     * @returns {boolean}
     */
    needsHybridMode() {
        if (this.targetFPS <= 0) return true; // Unlimited
        return this.targetFPS > this.monitorRefreshRate;
    }

    /**
     * Set the desired FPS cap. A value of 0 disables the cap (unlimited).
     * @param {number} fps
     */
    setTargetFPS(fps) {
        if (typeof fps !== 'number' || Number.isNaN(fps) || fps < 0) {
            console.warn('[FrameRate] Invalid FPS value, ignoring:', fps);
            return;
        }

        this.targetFPS = fps;
        this.frameInterval = fps > 0 ? 1000 / fps : 0;
        console.log(`[FrameRate] Target FPS set to ${fps === 0 ? 'Unlimited' : fps}`);
    }

    /**
     * Update VSync preference.
     * @param {boolean} enabled
     */
    setVSync(enabled) {
        this.vsyncEnabled = !!enabled;
        console.log(`[FrameRate] VSync ${this.vsyncEnabled ? 'enabled' : 'disabled'}`);
    }

    /**
     * Determine whether the current frame should be processed based on the FPS cap.
     * Call this at the start of a render loop to optionally skip work.
     * @param {number} [currentTime=performance.now()]
     * @returns {boolean} True if frame should be processed.
     */
    shouldProcessFrame(currentTime = performance.now()) {
        if (this.targetFPS <= 0) {
            this.lastProcessedTime = currentTime;
            return true;
        }

        const delta = currentTime - this.lastProcessedTime;
        if (delta < this.frameInterval) {
            return false;
        }

        this.lastProcessedTime = currentTime;
        return true;
    }

    /**
     * Record that a frame has been processed and update FPS statistics.
     * @param {number} [currentTime=performance.now()]
     * @returns {{current:number, average:number, min:number, max:number}}
     */
    recordFrame(currentTime = performance.now()) {
        const delta = currentTime - this.lastFrameTime;
        this.lastFrameTime = currentTime;

        this.frameCount += 1;

        const elapsedSinceStats = currentTime - this.lastStatsUpdate;
        if (elapsedSinceStats >= 1000) {
            this.actualFPS = Math.round((this.frameCount * 1000) / elapsedSinceStats);
            this.frameCount = 0;
            this.lastStatsUpdate = currentTime;

            if (this.actualFPS > 0) {
                this.fpsHistory.push(this.actualFPS);
                if (this.fpsHistory.length > this.maxFPSHistory) {
                    this.fpsHistory.shift();
                }
            }
        }

        return this.getStats();
    }

    /**
     * Reset accumulated FPS statistics.
     */
    resetStats() {
        this.frameCount = 0;
        this.actualFPS = 0;
        this.lastStatsUpdate = performance.now();
        this.fpsHistory = [];
    }

    /**
     * Return current FPS metrics.
     * @returns {{current:number, average:number, min:number, max:number, logicUPS:number}}
     */
    getStats() {
        const history = this.fpsHistory.length > 0 ? this.fpsHistory : [this.actualFPS || 0];
        const current = this.actualFPS || history[history.length - 1] || 0;
        const average = history.length
            ? Math.round(history.reduce((sum, value) => sum + value, 0) / history.length)
            : 0;

        return {
            current,
            average,
            min: history.length ? Math.min(...history) : 0,
            max: history.length ? Math.max(...history) : 0,
            logicUPS: this.logicUpdatesPerSecond, // Logic updates per second (for hybrid mode)
        };
    }

    /**
     * Start the hybrid game loop
     * @param {Function} updateFn - Game logic update function (called at target FPS)
     * @param {Function} renderFn - Render function (called at monitor refresh rate)
     */
    startHybridLoop(updateFn, renderFn) {
        if (this.isRunning) {
            console.warn('[FrameRate] Hybrid loop already running');
            return;
        }

        this.updateCallback = updateFn;
        this.renderCallback = renderFn;
        this.isRunning = true;
        this.lastLogicTime = performance.now();
        this.lastRenderTime = this.lastLogicTime;
        this.accumulator = 0;
        this.logicUpdateCount = 0;
        this.lastLogicStatsUpdate = this.lastLogicTime;

        console.log(`[FrameRate] Starting hybrid loop - Logic: ${this.targetFPS || 'unlimited'} FPS, Render: ${this.monitorRefreshRate}Hz`);

        // Start the logic update loop (setTimeout-based for high FPS)
        this._scheduleLogicUpdate();

        // Start the render loop (requestAnimationFrame-based)
        this._scheduleRender();
    }

    /**
     * Stop the hybrid game loop
     */
    stopHybridLoop() {
        this.isRunning = false;

        if (this.logicTimeoutId !== null) {
            clearTimeout(this.logicTimeoutId);
            this.logicTimeoutId = null;
        }

        if (this.renderAnimationId !== null) {
            cancelAnimationFrame(this.renderAnimationId);
            this.renderAnimationId = null;
        }

        this.updateCallback = null;
        this.renderCallback = null;
        console.log('[FrameRate] Hybrid loop stopped');
    }

    /**
     * Pause the hybrid loop (keeps callbacks, just stops scheduling)
     */
    pauseHybridLoop() {
        if (this.logicTimeoutId !== null) {
            clearTimeout(this.logicTimeoutId);
            this.logicTimeoutId = null;
        }
        // Keep render loop running for paused screen display
    }

    /**
     * Resume the hybrid loop after pause
     */
    resumeHybridLoop() {
        if (!this.isRunning || !this.updateCallback) return;

        this.lastLogicTime = performance.now();
        this.accumulator = 0;
        this._scheduleLogicUpdate();
    }

    /**
     * Schedule the next logic update
     * @private
     */
    _scheduleLogicUpdate() {
        if (!this.isRunning) return;

        const now = performance.now();
        const targetInterval = this.targetFPS > 0 ? 1000 / this.targetFPS : 1; // 1ms for unlimited

        // Calculate time until next update
        const elapsed = now - this.lastLogicTime;
        const delay = Math.max(0, targetInterval - elapsed);

        this.logicTimeoutId = setTimeout(() => this._logicTick(), delay);
    }

    /**
     * Logic update tick
     * @private
     */
    _logicTick() {
        if (!this.isRunning) return;

        const now = performance.now();
        const delta = now - this.lastLogicTime;
        this.lastLogicTime = now;

        // Track logic updates per second
        this.logicUpdateCount++;
        const statsDelta = now - this.lastLogicStatsUpdate;
        if (statsDelta >= 1000) {
            this.logicUpdatesPerSecond = Math.round((this.logicUpdateCount * 1000) / statsDelta);
            this.logicUpdateCount = 0;
            this.lastLogicStatsUpdate = now;
        }

        // Call the update function with delta time
        if (this.updateCallback) {
            try {
                this.updateCallback(now, delta);
            } catch (error) {
                console.error('[FrameRate] Error in update callback:', error);
            }
        }

        // Schedule next logic update
        this._scheduleLogicUpdate();
    }

    /**
     * Schedule the next render frame
     * @private
     */
    _scheduleRender() {
        if (!this.isRunning) return;

        this.renderAnimationId = requestAnimationFrame((timestamp) => this._renderTick(timestamp));
    }

    /**
     * Render tick
     * @private
     */
    _renderTick(timestamp) {
        if (!this.isRunning) return;

        // Record frame for FPS stats
        this.recordFrame(timestamp);

        // Calculate interpolation alpha for smooth rendering between logic frames
        const targetInterval = this.targetFPS > 0 ? 1000 / this.targetFPS : 16.67;
        const timeSinceLastLogic = timestamp - this.lastLogicTime;
        const alpha = Math.min(1, timeSinceLastLogic / targetInterval);

        // Call render with interpolation alpha
        if (this.renderCallback) {
            try {
                this.renderCallback(timestamp, alpha);
            } catch (error) {
                console.error('[FrameRate] Error in render callback:', error);
            }
        }

        // Schedule next render
        this._scheduleRender();
    }

    /**
     * Get interpolation alpha for smooth rendering between logic frames
     * @returns {number} Value between 0 and 1
     */
    getInterpolationAlpha() {
        if (this.targetFPS <= 0) return 1;

        const now = performance.now();
        const targetInterval = 1000 / this.targetFPS;
        const timeSinceLastLogic = now - this.lastLogicTime;
        return Math.min(1, timeSinceLastLogic / targetInterval);
    }
}
