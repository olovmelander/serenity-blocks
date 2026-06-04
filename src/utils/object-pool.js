/**
 * @fileoverview Object Pooling System
 * Reuses objects to reduce garbage collection pressure
 * Phase 3 Architecture Improvement
 */

/**
 * Generic object pool for reusing objects
 * Reduces GC pressure by recycling objects instead of creating/destroying
 */
export class ObjectPool {
    /**
     * Create an object pool
     * @param {Function} factory - Function to create new objects
     * @param {Function} reset - Function to reset object state
     * @param {number} initialSize - Pre-allocated pool size
     * @param {number} maxSize - Maximum pool size (0 = unlimited)
     */
    constructor(factory, reset, initialSize = 50, maxSize = 500) {
        this.factory = factory;
        this.reset = reset;
        this.maxSize = maxSize;

        // Available objects ready for reuse
        this.pool = [];

        // Objects currently in use
        this.active = new Set();

        // Statistics
        this.stats = {
            created: 0,
            reused: 0,
            released: 0,
            active: 0,
            poolSize: 0,
        };

        // Pre-allocate objects
        for (let i = 0; i < initialSize; i++) {
            this.pool.push(this.factory());
            this.stats.created++;
        }

        console.log(`[ObjectPool] Initialized with ${initialSize} objects (max: ${maxSize || 'unlimited'})`);
    }

    /**
     * Acquire an object from the pool
     * @returns {Object} Pooled object
     */
    acquire() {
        let obj;

        if (this.pool.length > 0) {
            // Reuse from pool
            obj = this.pool.pop();
            this.stats.reused++;
        } else {
            // Create new if pool is empty
            obj = this.factory();
            this.stats.created++;
        }

        // Track as active
        this.active.add(obj);
        this.updateStats();

        return obj;
    }

    /**
     * Release an object back to the pool
     * @param {Object} obj - Object to return
     */
    release(obj) {
        if (!this.active.has(obj)) {
            console.warn('[ObjectPool] Attempted to release object not in active set');
            return;
        }

        // Remove from active
        this.active.delete(obj);

        // Reset state
        if (this.reset) {
            this.reset(obj);
        }

        // Return to pool if not at max size
        if (this.maxSize === 0 || this.pool.length < this.maxSize) {
            this.pool.push(obj);
            this.stats.released++;
        }
        // else: object is discarded (let GC handle it)

        this.updateStats();
    }

    /**
     * Release multiple objects at once
     * @param {Array} objects - Objects to release
     */
    releaseAll(objects) {
        objects.forEach((obj) => this.release(obj));
    }

    /**
     * Clear the pool (for cleanup)
     */
    clear() {
        this.pool = [];
        this.active.clear();
        this.updateStats();
        console.log('[ObjectPool] Cleared');
    }

    /**
     * Update statistics
     */
    updateStats() {
        this.stats.active = this.active.size;
        this.stats.poolSize = this.pool.length;
    }

    /**
     * Get pool statistics
     * @returns {Object} Statistics
     */
    getStats() {
        return { ...this.stats };
    }

    /**
     * Get available pool size
     * @returns {number} Number of objects in pool
     */
    getPoolSize() {
        return this.pool.length;
    }

    /**
     * Get active object count
     * @returns {number} Number of active objects
     */
    getActiveCount() {
        return this.active.size;
    }

    /**
     * Log pool status
     */
    logStatus() {
        console.log('[ObjectPool] Status:', {
            poolSize: this.pool.length,
            active: this.active.size,
            total: this.pool.length + this.active.size,
            stats: this.stats,
        });
    }
}

/**
 * Specialized pool for piece trail particles
 */
export class ParticlePool extends ObjectPool {
    constructor(initialSize = 100, maxSize = 500) {
        super(
            // Factory: create particle object
            () => ({
                x: 0,
                y: 0,
                vx: 0,
                vy: 0,
                life: 0,
                maxLife: 0,
                color: '#ffffff',
                size: 4,
                alpha: 1,
            }),
            // Reset: clear particle state
            (particle) => {
                particle.x = 0;
                particle.y = 0;
                particle.vx = 0;
                particle.vy = 0;
                particle.life = 0;
                particle.maxLife = 0;
                particle.color = '#ffffff';
                particle.size = 4;
                particle.alpha = 1;
            },
            initialSize,
            maxSize,
        );
    }
}

/**
 * Specialized pool for garbage entries
 */
export class GarbageEntryPool extends ObjectPool {
    constructor(initialSize = 50, maxSize = 200) {
        super(
            // Factory: create garbage entry
            () => ({
                type: 'line',
                holes: [],
                color: '#808080',
                duration: 0,
                attackId: null,
                team: null,
            }),
            // Reset: clear entry state
            (entry) => {
                entry.type = 'line';
                entry.holes = [];
                entry.color = '#808080';
                entry.duration = 0;
                entry.attackId = null;
                entry.team = null;
            },
            initialSize,
            maxSize,
        );
    }
}

/**
 * Specialized pool for active falling pieces
 */
export class PiecePool extends ObjectPool {
    constructor(initialSize = 40, maxSize = 160) {
        super(
            () => ({
                shapeKey: null,
                type: null,
                shape: null,
                rotation: 0,
                x: 0,
                y: 0,
                color: null,
            }),
            (piece) => {
                piece.shapeKey = null;
                piece.type = null;
                piece.shape = null;
                piece.rotation = 0;
                piece.x = 0;
                piece.y = 0;
                piece.color = null;
            },
            initialSize,
            maxSize,
        );
    }
}

/**
 * Specialized pool for temporary arrays (for collision checks, etc.)
 */
export class ArrayPool extends ObjectPool {
    constructor(arraySize = 10, initialPoolSize = 20, maxSize = 100) {
        super(
            // Factory: create array
            () => new Array(arraySize).fill(0),
            // Reset: fill with zeros
            (arr) => arr.fill(0),
            initialPoolSize,
            maxSize,
        );
    }
}

// Export singleton pools for common use cases
export const particlePool = new ParticlePool();
export const garbageEntryPool = new GarbageEntryPool();
export const piecePool = new PiecePool();

// Make pools available globally for debugging
if (typeof window !== 'undefined') {
    window.objectPools = {
        particle: particlePool,
        garbageEntry: garbageEntryPool,
        piece: piecePool,

        // Debug commands
        status: () => {
            console.group('Object Pool Status');
            console.log('Particle Pool:', particlePool.getStats());
            console.log('Garbage Entry Pool:', garbageEntryPool.getStats());
            console.log('Piece Pool:', piecePool.getStats());
            console.groupEnd();
        },

        clear: () => {
            particlePool.clear();
            garbageEntryPool.clear();
            piecePool.clear();
            console.log('All pools cleared');
        },
    };

    console.log('💡 Object pools available:');
    console.log('  window.objectPools.status() - View pool statistics');
    console.log('  window.objectPools.clear()  - Clear all pools');
}
