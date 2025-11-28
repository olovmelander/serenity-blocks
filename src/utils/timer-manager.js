/**
 * @fileoverview Timer Manager - Tracks and manages setInterval/setTimeout for proper cleanup
 *
 * Usage:
 * ```javascript
 * class MyComponent {
 *   constructor() {
 *     this.timers = new TimerManager();
 *   }
 *
 *   start() {
 *     // Use wrapper methods instead of native setInterval/setTimeout
 *     this.timers.setInterval(() => this.update(), 1000);
 *     this.timers.setTimeout(() => this.delayedAction(), 5000);
 *   }
 *
 *   destroy() {
 *     this.timers.clearAll(); // Clears all timers at once!
 *   }
 * }
 * ```
 */

export class TimerManager {
    constructor() {
        this.intervals = new Map(); // id -> { callback, delay, nativeId }
        this.timeouts = new Map(); // id -> { callback, delay, nativeId }
        this.nextId = 1;

        // Stats for debugging
        this.stats = {
            intervalsCreated: 0,
            timeoutsCreated: 0,
            intervalsCleared: 0,
            timeoutsCleared: 0,
        };
    }

    /**
     * Create a managed interval (replacement for setInterval)
     * @param {Function} callback - Function to call repeatedly
     * @param {number} delay - Delay in milliseconds
     * @returns {number} Timer ID (for manual clearing if needed)
     */
    setInterval(callback, delay) {
        if (typeof callback !== 'function') {
            throw new Error('[TimerManager] setInterval callback must be a function');
        }

        const id = this.nextId++;
        const nativeId = setInterval(callback, delay);

        this.intervals.set(id, {
            callback,
            delay,
            nativeId,
            createdAt: Date.now(),
        });

        this.stats.intervalsCreated++;

        return id;
    }

    /**
     * Create a managed timeout (replacement for setTimeout)
     * @param {Function} callback - Function to call once
     * @param {number} delay - Delay in milliseconds
     * @returns {number} Timer ID (for manual clearing if needed)
     */
    setTimeout(callback, delay) {
        if (typeof callback !== 'function') {
            throw new Error('[TimerManager] setTimeout callback must be a function');
        }

        const id = this.nextId++;
        const nativeId = setTimeout(() => {
            // Auto-remove from tracking after execution
            this.timeouts.delete(id);
            callback();
        }, delay);

        this.timeouts.set(id, {
            callback,
            delay,
            nativeId,
            createdAt: Date.now(),
        });

        this.stats.timeoutsCreated++;

        return id;
    }

    /**
     * Clear a specific interval
     * @param {number} id - Timer ID returned from setInterval
     * @returns {boolean} True if timer was found and cleared
     */
    clearInterval(id) {
        const timer = this.intervals.get(id);
        if (!timer) {
            return false;
        }

        clearInterval(timer.nativeId);
        this.intervals.delete(id);
        this.stats.intervalsCleared++;

        return true;
    }

    /**
     * Clear a specific timeout
     * @param {number} id - Timer ID returned from setTimeout
     * @returns {boolean} True if timer was found and cleared
     */
    clearTimeout(id) {
        const timer = this.timeouts.get(id);
        if (!timer) {
            return false;
        }

        clearTimeout(timer.nativeId);
        this.timeouts.delete(id);
        this.stats.timeoutsCleared++;

        return true;
    }

    /**
     * Clear all intervals (but not timeouts)
     */
    clearAllIntervals() {
        const count = this.intervals.size;

        for (const [id, timer] of this.intervals.entries()) {
            clearInterval(timer.nativeId);
            this.stats.intervalsCleared++;
        }

        this.intervals.clear();

        if (count > 0) {
            console.log(`[TimerManager] Cleared ${count} intervals`);
        }
    }

    /**
     * Clear all timeouts (but not intervals)
     */
    clearAllTimeouts() {
        const count = this.timeouts.size;

        for (const [id, timer] of this.timeouts.entries()) {
            clearTimeout(timer.nativeId);
            this.stats.timeoutsCleared++;
        }

        this.timeouts.clear();

        if (count > 0) {
            console.log(`[TimerManager] Cleared ${count} timeouts`);
        }
    }

    /**
     * Clear ALL timers (intervals + timeouts)
     * Call this in your component's destroy/cleanup method
     */
    clearAll() {
        const intervalCount = this.intervals.size;
        const timeoutCount = this.timeouts.size;
        const total = intervalCount + timeoutCount;

        if (total > 0) {
            console.log(`[TimerManager] Clearing ${intervalCount} intervals and ${timeoutCount} timeouts`);
        }

        this.clearAllIntervals();
        this.clearAllTimeouts();

        if (total > 0) {
            console.log('✅ [TimerManager] All timers cleared');
        }
    }

    /**
     * Get count of active timers
     * @returns {{intervals: number, timeouts: number, total: number}}
     */
    getActiveCount() {
        return {
            intervals: this.intervals.size,
            timeouts: this.timeouts.size,
            total: this.intervals.size + this.timeouts.size,
        };
    }

    /**
     * Get statistics about timer usage
     * @returns {Object} Stats object
     */
    getStats() {
        return {
            ...this.stats,
            activeIntervals: this.intervals.size,
            activeTimeouts: this.timeouts.size,
            totalActive: this.intervals.size + this.timeouts.size,
        };
    }

    /**
     * List all active timers (for debugging)
     * @returns {Array} Array of timer info objects
     */
    listActiveTimers() {
        const timers = [];

        for (const [id, timer] of this.intervals.entries()) {
            timers.push({
                id,
                type: 'interval',
                delay: timer.delay,
                age: Date.now() - timer.createdAt,
                callback: timer.callback.toString().substring(0, 100),
            });
        }

        for (const [id, timer] of this.timeouts.entries()) {
            timers.push({
                id,
                type: 'timeout',
                delay: timer.delay,
                age: Date.now() - timer.createdAt,
                callback: timer.callback.toString().substring(0, 100),
            });
        }

        return timers;
    }

    /**
     * Warn if timers are leaked (not cleaned up)
     * Call this in development mode before destroying component
     */
    warnIfLeaked() {
        const active = this.getActiveCount();

        if (active.total > 0) {
            console.warn(
                '[TimerManager] Potential timer leak detected! '
                + `${active.intervals} intervals and ${active.timeouts} timeouts still active.`,
            );
            console.warn('[TimerManager] Active timers:', this.listActiveTimers());
        }
    }

    /**
     * Destroy the timer manager and clean up all timers
     */
    destroy() {
        this.clearAll();
        this.intervals = null;
        this.timeouts = null;
        this.stats = null;
    }
}

/**
 * Create a singleton timer manager for global use (optional)
 * Import this if you want a shared timer manager
 */
export const globalTimerManager = new TimerManager();
