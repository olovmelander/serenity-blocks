/**
 * @fileoverview Weak Reference Cache Utilities (Phase 6.2)
 *
 * Provides WeakMap and WeakSet based caches for automatic memory management.
 * When keys (objects) are garbage collected, their entries are automatically removed.
 *
 * **When to Use:**
 * - DOM element metadata (element -> data)
 * - Component instance tracking (object -> metadata)
 * - Temporary object associations
 * - Event/object processing caches
 *
 * **When NOT to Use:**
 * - Need to iterate over all keys (WeakMap keys not enumerable)
 * - Keys are primitives (strings, numbers) - use regular Map
 * - Need explicit LRU eviction - use regular Map with eviction logic
 *
 * @example
 * import { ElementDataCache, ComponentTracker } from './utils/weak-cache.js';
 *
 * const cache = new ElementDataCache();
 * const element = document.querySelector('.my-element');
 * cache.set(element, { initialized: true, data: {...} });
 *
 * // Later, when element is removed from DOM and no references exist
 * // The cache entry is automatically garbage collected
 */

/**
 * WeakMap-based cache for DOM element metadata
 * Automatically cleans up when elements are garbage collected
 */
export class ElementDataCache {
    constructor() {
        // WeakMap allows garbage collection when element is removed
        this.cache = new WeakMap();
        this.stats = {
            sets: 0,
            gets: 0,
            hits: 0,
            deletes: 0,
        };
    }

    /**
     * Store data for an element
     * @param {Element} element - DOM element (must be object, not primitive)
     * @param {*} data - Data to associate with element
     */
    set(element, data) {
        if (!(element instanceof Object)) {
            throw new TypeError('WeakMap keys must be objects');
        }
        this.cache.set(element, data);
        this.stats.sets++;
    }

    /**
     * Get data for an element
     * @param {Element} element - DOM element
     * @returns {*} Associated data or undefined
     */
    get(element) {
        this.stats.gets++;
        const data = this.cache.get(element);
        if (data !== undefined) {
            this.stats.hits++;
        }
        return data;
    }

    /**
     * Check if element has data
     * @param {Element} element - DOM element
     * @returns {boolean}
     */
    has(element) {
        return this.cache.has(element);
    }

    /**
     * Delete data for an element
     * @param {Element} element - DOM element
     * @returns {boolean} True if deleted
     */
    delete(element) {
        const deleted = this.cache.delete(element);
        if (deleted) {
            this.stats.deletes++;
        }
        return deleted;
    }

    /**
     * Get statistics
     * @returns {Object}
     */
    getStats() {
        const hitRate = this.stats.gets > 0
            ? `${((this.stats.hits / this.stats.gets) * 100).toFixed(2)}%`
            : '0.00%';

        return {
            ...this.stats,
            hitRate,
        };
    }

    /**
     * Reset statistics
     */
    resetStats() {
        this.stats = {
            sets: 0,
            gets: 0,
            hits: 0,
            deletes: 0,
        };
    }
}

/**
 * Component instance tracker using WeakMap
 * Tracks metadata for component instances without preventing GC
 */
export class ComponentTracker {
    constructor() {
        this.metadata = new WeakMap();
        this.createdCount = 0;
    }

    /**
     * Register a component with metadata
     * @param {Object} component - Component instance
     * @param {Object} meta - Metadata (timestamps, type, etc.)
     */
    register(component, meta = {}) {
        if (!(component instanceof Object)) {
            throw new TypeError('Component must be an object');
        }

        this.metadata.set(component, {
            ...meta,
            createdAt: Date.now(),
            id: this.createdCount++,
        });
    }

    /**
     * Get component metadata
     * @param {Object} component - Component instance
     * @returns {Object|undefined}
     */
    getMetadata(component) {
        return this.metadata.get(component);
    }

    /**
     * Update component metadata
     * @param {Object} component - Component instance
     * @param {Object} updates - Metadata updates
     */
    update(component, updates) {
        const existing = this.metadata.get(component);
        if (existing) {
            this.metadata.set(component, {
                ...existing,
                ...updates,
                updatedAt: Date.now(),
            });
        }
    }

    /**
     * Check if component is tracked
     * @param {Object} component - Component instance
     * @returns {boolean}
     */
    isTracked(component) {
        return this.metadata.has(component);
    }

    /**
     * Unregister component
     * @param {Object} component - Component instance
     */
    unregister(component) {
        this.metadata.delete(component);
    }

    /**
     * Get total components created (doesn't reflect current count due to GC)
     * @returns {number}
     */
    getTotalCreated() {
        return this.createdCount;
    }
}

/**
 * WeakSet-based tracker for processed objects
 * Useful for tracking which objects have been processed without preventing GC
 */
export class ProcessedTracker {
    constructor() {
        this.processed = new WeakSet();
        this.processCount = 0;
    }

    /**
     * Mark object as processed
     * @param {Object} obj - Object to mark
     */
    markProcessed(obj) {
        if (!(obj instanceof Object)) {
            throw new TypeError('WeakSet values must be objects');
        }
        if (!this.processed.has(obj)) {
            this.processed.add(obj);
            this.processCount++;
        }
    }

    /**
     * Check if object was processed
     * @param {Object} obj - Object to check
     * @returns {boolean}
     */
    isProcessed(obj) {
        return this.processed.has(obj);
    }

    /**
     * Remove from processed set
     * @param {Object} obj - Object to unmark
     */
    unmark(obj) {
        this.processed.delete(obj);
    }

    /**
     * Get total objects processed (lifetime count)
     * @returns {number}
     */
    getTotalProcessed() {
        return this.processCount;
    }
}

/**
 * Event data cache using WeakMap
 * Caches processed event data to avoid re-processing
 */
export class EventDataCache {
    constructor() {
        this.cache = new WeakMap();
        this.hits = 0;
        this.misses = 0;
    }

    /**
     * Get or compute event data
     * @param {Event} event - DOM event
     * @param {Function} computeFn - Function to compute data if not cached
     * @returns {*} Cached or computed data
     */
    getOrCompute(event, computeFn) {
        if (this.cache.has(event)) {
            this.hits++;
            return this.cache.get(event);
        }

        this.misses++;
        const data = computeFn(event);
        this.cache.set(event, data);
        return data;
    }

    /**
     * Get cache hit rate
     * @returns {string} Hit rate percentage
     */
    getHitRate() {
        const total = this.hits + this.misses;
        if (total === 0) return '0.00%';
        return `${((this.hits / total) * 100).toFixed(2)}%`;
    }

    /**
     * Get statistics
     * @returns {Object}
     */
    getStats() {
        return {
            hits: this.hits,
            misses: this.misses,
            total: this.hits + this.misses,
            hitRate: this.getHitRate(),
        };
    }

    /**
     * Reset statistics
     */
    resetStats() {
        this.hits = 0;
        this.misses = 0;
    }
}

/**
 * Global instances for common use cases
 */
export const globalElementCache = new ElementDataCache();
export const globalComponentTracker = new ComponentTracker();

// Expose to window for debugging
if (typeof window !== 'undefined') {
    window.weakCacheUtils = {
        elementCache: globalElementCache,
        componentTracker: globalComponentTracker,
    };
    console.log('💡 Weak cache utilities available: window.weakCacheUtils');
}

/**
 * Utility: Create a memoized function using WeakMap for object arguments
 * @param {Function} fn - Function to memoize
 * @returns {Function} Memoized function
 */
export function weakMemoize(fn) {
    const cache = new WeakMap();

    return function (obj, ...args) {
        if (!(obj instanceof Object)) {
            // For primitives, just call function (can't use WeakMap)
            return fn(obj, ...args);
        }

        if (cache.has(obj)) {
            return cache.get(obj);
        }

        const result = fn(obj, ...args);
        cache.set(obj, result);
        return result;
    };
}

/**
 * Usage Examples
 */
export const WeakCacheExamples = {
    /**
     * Example 1: Element metadata cache
     */
    elementMetadataExample() {
        const cache = new ElementDataCache();
        const button = document.querySelector('button');

        // Store metadata
        cache.set(button, {
            clicked: 0,
            lastClick: null,
            initialized: true,
        });

        // Retrieve metadata
        const data = cache.get(button);
        console.log('Button metadata:', data);

        // When button is removed from DOM and no references exist,
        // the cache entry is automatically garbage collected
    },

    /**
     * Example 2: Component tracking
     */
    componentTrackingExample() {
        const tracker = new ComponentTracker();

        class MyComponent {
            constructor(name) {
                this.name = name;
                tracker.register(this, { type: 'MyComponent', name });
            }
        }

        const comp1 = new MyComponent('comp1');
        const comp2 = new MyComponent('comp2');

        console.log('comp1 metadata:', tracker.getMetadata(comp1));
        console.log('Total created:', tracker.getTotalCreated());

        // When comp1/comp2 go out of scope, they're GC'd automatically
    },

    /**
     * Example 3: Processed object tracking
     */
    processedTrackingExample() {
        const processed = new ProcessedTracker();

        function processItem(item) {
            if (processed.isProcessed(item)) {
                console.log('Already processed, skipping');
                return;
            }

            // Process item...
            console.log('Processing:', item);
            processed.markProcessed(item);
        }

        const obj = { id: 1, data: 'test' };
        processItem(obj); // Processes
        processItem(obj); // Skips (already processed)
    },

    /**
     * Example 4: Event data caching
     */
    eventDataCacheExample() {
        const eventCache = new EventDataCache();

        document.addEventListener('mousemove', (e) => {
            // Expensive computation cached per event object
            const data = eventCache.getOrCompute(e, (event) =>
                // Expensive calculation
                ({
                    distance: Math.sqrt(event.clientX ** 2 + event.clientY ** 2),
                    angle: Math.atan2(event.clientY, event.clientX),
                    quadrant: Math.floor(Math.atan2(event.clientY, event.clientX) / (Math.PI / 2)),
                }));

            console.log('Event data:', data);
            console.log('Cache hit rate:', eventCache.getHitRate());
        });
    },
};
