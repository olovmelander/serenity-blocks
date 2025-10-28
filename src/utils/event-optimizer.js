/**
 * @fileoverview Event System Optimization Utilities
 * Debouncing, throttling, and batching for better performance
 * Phase 3 Architecture Improvement
 */

/**
 * Debounce a function - calls only after quiet period
 * @param {Function} func - Function to debounce
 * @param {number} wait - Wait time in ms
 * @returns {Function} Debounced function
 */
export function debounce(func, wait = 100) {
    let timeout;

    const debounced = function(...args) {
        const context = this;

        clearTimeout(timeout);
        timeout = setTimeout(() => {
            func.apply(context, args);
        }, wait);
    };

    debounced.cancel = () => {
        clearTimeout(timeout);
    };

    return debounced;
}

/**
 * Throttle a function - calls at most once per interval
 * @param {Function} func - Function to throttle
 * @param {number} limit - Minimum time between calls in ms
 * @returns {Function} Throttled function
 */
export function throttle(func, limit = 100) {
    let inThrottle;
    let lastResult;

    return function(...args) {
        const context = this;

        if (!inThrottle) {
            lastResult = func.apply(context, args);
            inThrottle = true;

            setTimeout(() => {
                inThrottle = false;
            }, limit);
        }

        return lastResult;
    };
}

/**
 * Request Animation Frame throttle - calls once per frame
 * @param {Function} func - Function to throttle
 * @returns {Function} RAF-throttled function
 */
export function rafThrottle(func) {
    let rafId = null;
    let lastArgs = null;

    const throttled = function(...args) {
        lastArgs = args;

        if (rafId === null) {
            rafId = requestAnimationFrame(() => {
                func.apply(this, lastArgs);
                rafId = null;
                lastArgs = null;
            });
        }
    };

    throttled.cancel = () => {
        if (rafId !== null) {
            cancelAnimationFrame(rafId);
            rafId = null;
            lastArgs = null;
        }
    };

    return throttled;
}

/**
 * Event batcher - batches multiple events and processes them together
 */
export class EventBatcher {
    constructor(processFn, delay = 16) {
        this.processFn = processFn;
        this.delay = delay;
        this.queue = [];
        this.timeoutId = null;
    }

    /**
     * Add event to batch
     * @param {*} event - Event data
     */
    add(event) {
        this.queue.push(event);

        if (!this.timeoutId) {
            this.timeoutId = setTimeout(() => {
                this.flush();
            }, this.delay);
        }
    }

    /**
     * Process all queued events
     */
    flush() {
        if (this.queue.length > 0) {
            const batch = [...this.queue];
            this.queue = [];
            this.processFn(batch);
        }

        this.timeoutId = null;
    }

    /**
     * Clear pending events
     */
    clear() {
        this.queue = [];
        if (this.timeoutId) {
            clearTimeout(this.timeoutId);
            this.timeoutId = null;
        }
    }

    /**
     * Get queue size
     * @returns {number} Number of pending events
     */
    size() {
        return this.queue.length;
    }
}

/**
 * Optimized event emitter with batching support
 */
export class OptimizedEventEmitter {
    constructor() {
        this.listeners = new Map();
        this.batchers = new Map();
    }

    /**
     * Register event listener
     * @param {string} event - Event name
     * @param {Function} callback - Callback function
     * @param {Object} options - Options (batched, throttle, debounce)
     */
    on(event, callback, options = {}) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, []);
        }

        let wrappedCallback = callback;

        // Apply optimizations
        if (options.debounce) {
            wrappedCallback = debounce(callback, options.debounce);
        } else if (options.throttle) {
            wrappedCallback = throttle(callback, options.throttle);
        } else if (options.rafThrottle) {
            wrappedCallback = rafThrottle(callback);
        }

        const listener = {
            callback: wrappedCallback,
            original: callback,
            options,
        };

        this.listeners.get(event).push(listener);

        // Setup batcher if requested
        if (options.batched) {
            if (!this.batchers.has(event)) {
                const batcher = new EventBatcher(
                    (batch) => {
                        this.listeners.get(event)?.forEach(l => {
                            if (l.options.batched) {
                                l.callback(batch);
                            }
                        });
                    },
                    options.batchDelay || 16
                );
                this.batchers.set(event, batcher);
            }
        }
    }

    /**
     * Unregister event listener
     * @param {string} event - Event name
     * @param {Function} callback - Callback to remove
     */
    off(event, callback) {
        const listeners = this.listeners.get(event);
        if (!listeners) return;

        const index = listeners.findIndex(l => l.original === callback);
        if (index !== -1) {
            listeners.splice(index, 1);
        }

        // Clean up empty arrays
        if (listeners.length === 0) {
            this.listeners.delete(event);
            this.batchers.delete(event);
        }
    }

    /**
     * Emit event
     * @param {string} event - Event name
     * @param {*} data - Event data
     */
    emit(event, data) {
        const batcher = this.batchers.get(event);
        if (batcher) {
            // Add to batch
            batcher.add(data);
        } else {
            // Emit immediately
            const listeners = this.listeners.get(event);
            if (listeners) {
                listeners.forEach(l => {
                    if (!l.options.batched) {
                        try {
                            l.callback(data);
                        } catch (error) {
                            console.error(`[EventEmitter] Error in ${event} handler:`, error);
                        }
                    }
                });
            }
        }
    }

    /**
     * Emit event once (one-time listener)
     * @param {string} event - Event name
     * @param {Function} callback - Callback function
     */
    once(event, callback) {
        const wrappedCallback = (data) => {
            callback(data);
            this.off(event, callback);
        };

        this.on(event, wrappedCallback);
    }

    /**
     * Remove all listeners for an event
     * @param {string} event - Event name (or all if not specified)
     */
    removeAllListeners(event) {
        if (event) {
            this.listeners.delete(event);
            this.batchers.delete(event);
        } else {
            this.listeners.clear();
            this.batchers.clear();
        }
    }

    /**
     * Get listener count for an event
     * @param {string} event - Event name
     * @returns {number} Number of listeners
     */
    listenerCount(event) {
        return this.listeners.get(event)?.length || 0;
    }

    /**
     * Flush all batchers immediately
     */
    flushAll() {
        this.batchers.forEach(batcher => batcher.flush());
    }
}

/**
 * Memoize expensive function calls
 * @param {Function} func - Function to memoize
 * @param {Function} keyGen - Custom key generator (optional)
 * @param {number} maxSize - Maximum cache size
 * @returns {Function} Memoized function
 */
export function memoize(func, keyGen = null, maxSize = 1000) {
    const cache = new Map();

    const memoized = function(...args) {
        const key = keyGen ? keyGen(...args) : JSON.stringify(args);

        if (cache.has(key)) {
            return cache.get(key);
        }

        const result = func.apply(this, args);

        // Simple FIFO eviction if cache is full
        if (cache.size >= maxSize) {
            const firstKey = cache.keys().next().value;
            cache.delete(firstKey);
        }

        cache.set(key, result);
        return result;
    };

    memoized.cache = cache;
    memoized.clear = () => cache.clear();

    return memoized;
}

// Export singleton optimized event emitter
export const optimizedEventBus = new OptimizedEventEmitter();

// Expose utilities globally for debugging
if (typeof window !== 'undefined') {
    window.eventOptimizer = {
        debounce,
        throttle,
        rafThrottle,
        memoize,
        eventBus: optimizedEventBus,

        // Debug commands
        status: () => {
            console.group('Event System Status');
            console.log('Total event types:', optimizedEventBus.listeners.size);
            console.log('Active batchers:', optimizedEventBus.batchers.size);
            optimizedEventBus.listeners.forEach((listeners, event) => {
                console.log(`  ${event}: ${listeners.length} listeners`);
            });
            console.groupEnd();
        },
    };

    console.log('💡 Event optimizer available:');
    console.log('  window.eventOptimizer.status() - View event system status');
}
