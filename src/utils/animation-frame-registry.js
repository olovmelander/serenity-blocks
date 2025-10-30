/**
 * @fileoverview Animation Frame Registry - Track active animation frames for debugging
 * 
 * This is a development tool to help detect animation frame leaks.
 * 
 * Usage:
 * ```javascript
 * import { AnimationFrameRegistry } from './utils/animation-frame-registry.js';
 * 
 * const frameRegistry = new AnimationFrameRegistry();
 * 
 * // Instead of:
 * const id = requestAnimationFrame(callback);
 * 
 * // Use:
 * const id = frameRegistry.register(() => callback(), 'MyComponent');
 * 
 * // Cancel:
 * frameRegistry.cancel(id);
 * 
 * // Or cancel all from a source:
 * frameRegistry.cancelAll('MyComponent');
 * 
 * // Check for leaks:
 * console.log('Active frames:', frameRegistry.getActiveCount());
 * frameRegistry.listActive();
 * ```
 */

export class AnimationFrameRegistry {
    constructor(options = {}) {
        this.frames = new Map(); // frameId -> { source, callback, timestamp }
        this.enableLogging = options.enableLogging !== false;
        
        // Stats
        this.stats = {
            registered: 0,
            cancelled: 0,
            executed: 0
        };
    }

    /**
     * Register an animation frame with tracking
     * @param {Function} callback - Function to call on next frame
     * @param {string} source - Source component name (for debugging)
     * @returns {number} Frame ID (can be used to cancel)
     */
    register(callback, source = 'unknown') {
        if (typeof callback !== 'function') {
            throw new Error('[AnimationFrameRegistry] Callback must be a function');
        }

        // Wrap callback to track execution
        const wrappedCallback = (...args) => {
            // Remove from tracking when executed
            this.frames.delete(frameId);
            this.stats.executed++;
            
            // Call original callback
            return callback(...args);
        };

        const frameId = requestAnimationFrame(wrappedCallback);
        
        this.frames.set(frameId, {
            source,
            callback,
            timestamp: Date.now(),
            stack: this.enableLogging ? new Error().stack : null
        });
        
        this.stats.registered++;
        
        if (this.enableLogging) {
            console.log(`[AnimationFrameRegistry] Registered frame #${frameId} from ${source}`);
        }
        
        return frameId;
    }

    /**
     * Cancel a specific animation frame
     * @param {number} frameId - Frame ID to cancel
     * @returns {boolean} True if frame was found and cancelled
     */
    cancel(frameId) {
        const frame = this.frames.get(frameId);
        
        if (!frame) {
            return false;
        }

        cancelAnimationFrame(frameId);
        this.frames.delete(frameId);
        this.stats.cancelled++;
        
        if (this.enableLogging) {
            console.log(`[AnimationFrameRegistry] Cancelled frame #${frameId} from ${frame.source}`);
        }
        
        return true;
    }

    /**
     * Cancel all animation frames from a specific source
     * @param {string} source - Source component name
     * @returns {number} Number of frames cancelled
     */
    cancelAll(source) {
        let count = 0;
        
        for (const [frameId, frame] of this.frames.entries()) {
            if (frame.source === source) {
                cancelAnimationFrame(frameId);
                this.frames.delete(frameId);
                this.stats.cancelled++;
                count++;
            }
        }
        
        if (count > 0 && this.enableLogging) {
            console.log(`[AnimationFrameRegistry] Cancelled ${count} frames from ${source}`);
        }
        
        return count;
    }

    /**
     * Cancel all registered animation frames
     * @returns {number} Number of frames cancelled
     */
    cancelAllFrames() {
        const count = this.frames.size;
        
        for (const frameId of this.frames.keys()) {
            cancelAnimationFrame(frameId);
            this.stats.cancelled++;
        }
        
        this.frames.clear();
        
        if (count > 0 && this.enableLogging) {
            console.log(`[AnimationFrameRegistry] Cancelled all ${count} frames`);
        }
        
        return count;
    }

    /**
     * Get count of active (pending) animation frames
     * @returns {number} Number of active frames
     */
    getActiveCount() {
        return this.frames.size;
    }

    /**
     * Get active frames by source
     * @returns {Map<string, number>} Map of source -> frame count
     */
    getActiveBySource() {
        const bySource = new Map();
        
        for (const frame of this.frames.values()) {
            const current = bySource.get(frame.source) || 0;
            bySource.set(frame.source, current + 1);
        }
        
        return bySource;
    }

    /**
     * List all active frames (for debugging)
     * @returns {Array} Array of frame info objects
     */
    listActive() {
        const activeFrames = [];
        
        for (const [frameId, frame] of this.frames.entries()) {
            activeFrames.push({
                frameId,
                source: frame.source,
                age: Date.now() - frame.timestamp,
                callback: frame.callback.toString().substring(0, 100)
            });
        }
        
        return activeFrames;
    }

    /**
     * Log active frames grouped by source
     */
    logActiveFrames() {
        const bySource = this.getActiveBySource();
        
        console.group('[AnimationFrameRegistry] Active Animation Frames');
        console.log(`Total active frames: ${this.frames.size}`);
        
        if (bySource.size > 0) {
            console.log('\nBy source:');
            for (const [source, count] of bySource.entries()) {
                console.log(`  ${source}: ${count}`);
            }
            
            console.log('\nDetailed list:');
            console.table(this.listActive());
        } else {
            console.log('No active frames');
        }
        
        console.groupEnd();
    }

    /**
     * Detect potential animation frame leaks
     * Frames pending for > threshold milliseconds are considered leaked
     * @param {number} threshold - Age threshold in milliseconds (default: 5000)
     * @returns {Array} Array of potentially leaked frames
     */
    detectLeaks(threshold = 5000) {
        const leaks = [];
        const now = Date.now();
        
        for (const [frameId, frame] of this.frames.entries()) {
            const age = now - frame.timestamp;
            if (age > threshold) {
                leaks.push({
                    frameId,
                    source: frame.source,
                    age,
                    callback: frame.callback.toString().substring(0, 100),
                    stack: frame.stack
                });
            }
        }
        
        if (leaks.length > 0) {
            console.warn(
                `[AnimationFrameRegistry] Detected ${leaks.length} potential leaks ` +
                `(frames pending > ${threshold}ms)`
            );
            console.table(leaks);
        }
        
        return leaks;
    }

    /**
     * Get statistics
     * @returns {Object} Stats object
     */
    getStats() {
        return {
            ...this.stats,
            active: this.frames.size,
            leakRate: this.stats.registered > 0 
                ? ((this.stats.registered - this.stats.executed - this.stats.cancelled) / this.stats.registered * 100).toFixed(2) + '%'
                : '0%'
        };
    }

    /**
     * Start periodic leak detection
     * @param {number} interval - Check interval in milliseconds (default: 10000)
     * @param {number} threshold - Leak threshold in milliseconds (default: 5000)
     * @returns {number} Interval ID (use clearInterval to stop)
     */
    startLeakDetection(interval = 10000, threshold = 5000) {
        return setInterval(() => {
            this.detectLeaks(threshold);
        }, interval);
    }

    /**
     * Reset statistics
     */
    resetStats() {
        this.stats = {
            registered: 0,
            cancelled: 0,
            executed: 0
        };
    }

    /**
     * Destroy the registry and cancel all frames
     */
    destroy() {
        this.cancelAllFrames();
        this.frames = null;
        this.stats = null;
    }
}

/**
 * Global animation frame registry for development/debugging
 * Enable with: AnimationFrameRegistry.enable()
 */
export class GlobalAnimationFrameMonitor {
    static instance = null;
    static enabled = false;
    
    static enable(options = {}) {
        if (this.enabled) {
            console.warn('[GlobalAnimationFrameMonitor] Already enabled');
            return;
        }
        
        this.instance = new AnimationFrameRegistry(options);
        this.enabled = true;
        
        // Monkey-patch requestAnimationFrame for global tracking
        const original = window.requestAnimationFrame;
        window.requestAnimationFrame = (callback) => {
            if (this.enabled && this.instance) {
                // Try to get caller info from stack
                const stack = new Error().stack;
                const caller = this._extractCaller(stack);
                return this.instance.register(callback, caller);
            }
            return original.call(window, callback);
        };
        
        console.log('✅ [GlobalAnimationFrameMonitor] Enabled');
    }
    
    static disable() {
        if (!this.enabled) return;
        
        // TODO: Restore original requestAnimationFrame
        // (Requires storing original reference)
        
        if (this.instance) {
            this.instance.destroy();
            this.instance = null;
        }
        
        this.enabled = false;
        console.log('[GlobalAnimationFrameMonitor] Disabled');
    }
    
    static _extractCaller(stack) {
        const lines = stack.split('\n');
        // Skip first 3 lines (Error, this function, requestAnimationFrame wrapper)
        for (let i = 3; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line.includes('at ')) {
                // Extract function name and file
                const match = line.match(/at\s+(?:([^(]+)\s+\()?([^)]+)\)?$/);
                if (match) {
                    const funcName = match[1] || 'anonymous';
                    const file = match[2] ? match[2].split('/').pop() : 'unknown';
                    return `${funcName} (${file})`;
                }
            }
        }
        return 'unknown';
    }
    
    static getStats() {
        return this.instance ? this.instance.getStats() : null;
    }
    
    static logActive() {
        if (this.instance) {
            this.instance.logActiveFrames();
        }
    }
    
    static detectLeaks(threshold) {
        return this.instance ? this.instance.detectLeaks(threshold) : [];
    }
}

// Export for development console access
if (typeof window !== 'undefined') {
    window.AnimationFrameMonitor = GlobalAnimationFrameMonitor;
}

