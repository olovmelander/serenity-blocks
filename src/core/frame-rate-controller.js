/**
 * @fileoverview FrameRateController - manages FPS limiting, VSync state, and statistics.
 * Provides lightweight frame skipping support and exposes rolling FPS metrics.
 */

export class FrameRateController {
    constructor() {
        this.targetFPS = 60;
        this.vsyncEnabled = true;

        this.frameInterval = this.targetFPS > 0 ? 1000 / this.targetFPS : 0;
        this.lastFrameTime = performance.now();
        this.lastProcessedTime = this.lastFrameTime;

        this.lastStatsUpdate = this.lastFrameTime;
        this.frameCount = 0;
        this.actualFPS = 0;
        this.fpsHistory = [];
        this.maxFPSHistory = 120;
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
     * @returns {{current:number, average:number, min:number, max:number}}
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
        };
    }
}
