/**
 * @fileoverview Performance Utilities - Throttle, Debounce, and DOM optimization helpers
 *
 * These utilities help reduce CPU usage from high-frequency events and optimize DOM operations.
 */

/**
 * Throttle function - Ensures function is called at most once per specified time period
 * Use for: scroll, mousemove, resize events
 *
 * @param {Function} func - Function to throttle
 * @param {number} limit - Minimum time between calls in milliseconds
 * @returns {Function} Throttled function
 *
 * @example
 * const throttledScroll = throttle(() => {
 *   console.log('Scroll handler');
 * }, 100); // Max once every 100ms
 *
 * window.addEventListener('scroll', throttledScroll);
 */
export function throttle(func, limit) {
    let inThrottle;
    let lastFunc;
    let lastRan;

    return function executedFunction(...args) {
        const context = this;

        if (!inThrottle) {
            func.apply(context, args);
            lastRan = Date.now();
            inThrottle = true;
        } else {
            clearTimeout(lastFunc);
            lastFunc = setTimeout(() => {
                if ((Date.now() - lastRan) >= limit) {
                    func.apply(context, args);
                    lastRan = Date.now();
                }
            }, Math.max(limit - (Date.now() - lastRan), 0));
        }
    };
}

/**
 * Debounce function - Delays function execution until after specified time has elapsed
 * since last call. Use for: input, search, window resize that triggers heavy operations
 *
 * @param {Function} func - Function to debounce
 * @param {number} wait - Time to wait in milliseconds
 * @param {boolean} immediate - Execute on leading edge instead of trailing
 * @returns {Function} Debounced function
 *
 * @example
 * const debouncedSearch = debounce((query) => {
 *   performSearch(query);
 * }, 300); // Wait 300ms after last keystroke
 *
 * searchInput.addEventListener('input', (e) => debouncedSearch(e.target.value));
 */
export function debounce(func, wait, immediate = false) {
    let timeout;

    return function executedFunction(...args) {
        const context = this;

        const later = () => {
            timeout = null;
            if (!immediate) {
                func.apply(context, args);
            }
        };

        const callNow = immediate && !timeout;

        clearTimeout(timeout);
        timeout = setTimeout(later, wait);

        if (callNow) {
            func.apply(context, args);
        }
    };
}

/**
 * Request Animation Frame throttle - Ensures function is called at most once per frame
 * Best for visual updates that should sync with browser rendering
 *
 * @param {Function} func - Function to throttle
 * @returns {Function} RAF-throttled function
 *
 * @example
 * const throttledUpdate = rafThrottle(() => {
 *   updateVisualElement();
 * });
 *
 * window.addEventListener('mousemove', throttledUpdate);
 */
export function rafThrottle(func) {
    let rafId = null;
    let lastArgs = null;

    return function executedFunction(...args) {
        lastArgs = args;

        if (rafId === null) {
            rafId = requestAnimationFrame(() => {
                func.apply(this, lastArgs);
                rafId = null;
                lastArgs = null;
            });
        }
    };
}

/**
 * Batch DOM reads and writes to prevent layout thrashing
 * Collects all reads, executes them, then executes all writes
 *
 * @example
 * const batch = new DOMBatcher();
 *
 * batch.read(() => element1.offsetHeight);
 * batch.write(() => element2.style.height = '100px');
 * batch.read(() => element3.offsetWidth);
 * batch.write(() => element4.style.width = '200px');
 *
 * batch.flush(); // Executes: read1, read2, write1, write2
 */
export class DOMBatcher {
    constructor() {
        this.reads = [];
        this.writes = [];
        this.scheduled = false;
    }

    /**
     * Schedule a DOM read operation
     * @param {Function} callback - Function that reads from DOM
     */
    read(callback) {
        this.reads.push(callback);
        this.schedule();
    }

    /**
     * Schedule a DOM write operation
     * @param {Function} callback - Function that writes to DOM
     */
    write(callback) {
        this.writes.push(callback);
        this.schedule();
    }

    /**
     * Schedule the batch execution if not already scheduled
     */
    schedule() {
        if (!this.scheduled) {
            this.scheduled = true;
            requestAnimationFrame(() => this.flush());
        }
    }

    /**
     * Execute all reads, then all writes
     */
    flush() {
        // Execute all reads first
        const readResults = this.reads.map((read) => read());
        this.reads = [];

        // Then execute all writes
        this.writes.forEach((write) => write());
        this.writes = [];

        this.scheduled = false;

        return readResults;
    }

    /**
     * Clear all pending operations
     */
    clear() {
        this.reads = [];
        this.writes = [];
        this.scheduled = false;
    }
}

/**
 * Style Batcher - Batch style updates to prevent layout thrashing
 * Automatically flushes on next animation frame
 *
 * @example
 * const styleBatcher = new StyleBatcher();
 *
 * styleBatcher.setStyle(element1, 'width', '100px');
 * styleBatcher.setStyle(element2, 'height', '200px');
 * // Styles applied on next frame in batch
 */
export class StyleBatcher {
    constructor() {
        this.pending = new Map(); // element -> { property -> value }
        this.scheduled = false;
    }

    /**
     * Schedule a style update
     * @param {HTMLElement} element - Element to update
     * @param {string} property - CSS property
     * @param {string} value - CSS value
     */
    setStyle(element, property, value) {
        if (!this.pending.has(element)) {
            this.pending.set(element, new Map());
        }

        this.pending.get(element).set(property, value);
        this.schedule();
    }

    /**
     * Schedule multiple style updates for an element
     * @param {HTMLElement} element - Element to update
     * @param {Object} styles - Object with property-value pairs
     */
    setStyles(element, styles) {
        Object.entries(styles).forEach(([property, value]) => {
            this.setStyle(element, property, value);
        });
    }

    /**
     * Schedule the batch execution
     */
    schedule() {
        if (!this.scheduled) {
            this.scheduled = true;
            requestAnimationFrame(() => this.flush());
        }
    }

    /**
     * Apply all pending style updates
     */
    flush() {
        for (const [element, styles] of this.pending) {
            for (const [property, value] of styles) {
                element.style[property] = value;
            }
        }

        this.pending.clear();
        this.scheduled = false;
    }

    /**
     * Clear all pending updates
     */
    clear() {
        this.pending.clear();
        this.scheduled = false;
    }
}

/**
 * Passive event listener helper - Improves scroll performance
 *
 * @param {EventTarget} target - Element to attach listener to
 * @param {string} event - Event name
 * @param {Function} handler - Event handler
 * @param {boolean} useCapture - Use capture phase
 * @returns {Function} Cleanup function to remove listener
 *
 * @example
 * const cleanup = addPassiveListener(window, 'scroll', handleScroll);
 * // Later: cleanup();
 */
export function addPassiveListener(target, event, handler, useCapture = false) {
    target.addEventListener(event, handler, { passive: true, capture: useCapture });

    return () => {
        target.removeEventListener(event, handler, { capture: useCapture });
    };
}

/**
 * Optimized class toggle - More efficient than multiple add/remove calls
 *
 * @param {HTMLElement} element - Element to update
 * @param {Object} classes - Object with className -> boolean
 *
 * @example
 * toggleClasses(element, {
 *   'active': isActive,
 *   'disabled': isDisabled,
 *   'highlighted': isHighlighted
 * });
 */
export function toggleClasses(element, classes) {
    Object.entries(classes).forEach(([className, shouldAdd]) => {
        element.classList.toggle(className, shouldAdd);
    });
}

/**
 * Batch class operations - More efficient than multiple classList calls
 *
 * @param {HTMLElement} element - Element to update
 * @param {string[]} add - Classes to add
 * @param {string[]} remove - Classes to remove
 *
 * @example
 * batchClassOperations(element,
 *   ['active', 'visible'],      // add these
 *   ['hidden', 'disabled']      // remove these
 * );
 */
export function batchClassOperations(element, add = [], remove = []) {
    if (remove.length > 0) {
        element.classList.remove(...remove);
    }
    if (add.length > 0) {
        element.classList.add(...add);
    }
}

/**
 * Measure performance of a function
 *
 * @param {Function} func - Function to measure
 * @param {string} label - Label for console output
 * @returns {*} Result of function
 *
 * @example
 * const result = measurePerformance(() => {
 *   // expensive operation
 * }, 'MyOperation');
 * // Console: "MyOperation took 123.45ms"
 */
export function measurePerformance(func, label = 'Operation') {
    const start = performance.now();
    const result = func();
    const end = performance.now();
    console.log(`[Performance] ${label} took ${(end - start).toFixed(2)}ms`);
    return result;
}

/**
 * Create a memoized version of a function (caches results)
 *
 * @param {Function} func - Function to memoize
 * @param {Function} keyGenerator - Optional custom key generator
 * @returns {Function} Memoized function
 *
 * @example
 * const expensiveCalc = (a, b) => {
 *   // expensive calculation
 *   return a * b + Math.random();
 * };
 *
 * const memoized = memoize(expensiveCalc);
 * memoized(5, 10); // Calculates
 * memoized(5, 10); // Returns cached result
 */
export function memoize(func, keyGenerator) {
    const cache = new Map();

    return function (...args) {
        const key = keyGenerator ? keyGenerator(...args) : JSON.stringify(args);

        if (cache.has(key)) {
            return cache.get(key);
        }

        const result = func.apply(this, args);
        cache.set(key, result);

        return result;
    };
}

/**
 * Global singleton instances for common use cases
 */
export const globalDOMBatcher = new DOMBatcher();
export const globalStyleBatcher = new StyleBatcher();

/**
 * Performance monitoring helper
 */
export class PerformanceMonitor {
    constructor() {
        this.metrics = new Map();
    }

    /**
     * Start timing an operation
     * @param {string} label - Operation label
     */
    start(label) {
        this.metrics.set(label, performance.now());
    }

    /**
     * End timing and log result
     * @param {string} label - Operation label
     * @returns {number} Duration in milliseconds
     */
    end(label) {
        const start = this.metrics.get(label);
        if (!start) {
            console.warn(`[PerformanceMonitor] No start time for "${label}"`);
            return 0;
        }

        const duration = performance.now() - start;
        this.metrics.delete(label);

        console.log(`[PerformanceMonitor] ${label}: ${duration.toFixed(2)}ms`);
        return duration;
    }

    /**
     * Measure a function execution
     * @param {string} label - Operation label
     * @param {Function} func - Function to measure
     * @returns {*} Function result
     */
    measure(label, func) {
        this.start(label);
        const result = func();
        this.end(label);
        return result;
    }
}

export const globalPerformanceMonitor = new PerformanceMonitor();
