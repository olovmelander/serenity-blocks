/**
 * @fileoverview Asset Manager - Centralized asset loading and caching with LRU eviction
 *
 * Prevents duplicate asset loads, manages memory efficiently, and provides
 * preloading capabilities for faster theme switching.
 *
 * @example
 * import { assetManager } from './utils/asset-manager.js';
 *
 * // Load an image
 * const img = await assetManager.loadImage('/assets/theme.jpg');
 *
 * // Load multiple assets
 * await assetManager.preload([
 *   { url: '/assets/bg.jpg', type: 'image' },
 *   { url: '/assets/music.mp3', type: 'audio' }
 * ]);
 *
 * // Clear old assets
 * assetManager.clear();
 */

/**
 * Asset Manager - Manages loading, caching, and lifecycle of game assets
 */
export class AssetManager {
    constructor(options = {}) {
        this.cache = new Map(); // url -> asset
        this.loading = new Map(); // url -> Promise (for deduplication)
        this.maxCacheSize = options.maxCacheSize || 50;
        this.cacheOrder = []; // LRU tracking (oldest to newest)

        // Statistics
        this.stats = {
            cacheHits: 0,
            cacheMisses: 0,
            assetsLoaded: 0,
            assetsEvicted: 0,
            bytesLoaded: 0,
            loadErrors: 0,
        };

        // Asset metadata
        this.metadata = new Map(); // url -> { size, loadTime, lastAccess, type }
    }

    /**
     * Load an asset (with caching)
     * @param {string} url - Asset URL
     * @param {string} type - Asset type ('image', 'audio', 'json', 'text')
     * @param {Object} options - Loading options
     * @returns {Promise<*>} Loaded asset
     */
    async load(url, type = 'image', options = {}) {
        // Check cache first
        if (this.cache.has(url)) {
            this.stats.cacheHits++;
            this.updateLRU(url);
            this.updateLastAccess(url);
            console.log(`[AssetManager] Cache hit: ${url}`);
            return this.cache.get(url);
        }

        // Check if already loading (deduplicate requests)
        if (this.loading.has(url)) {
            console.log(`[AssetManager] Already loading: ${url}`);
            return this.loading.get(url);
        }

        // Start new load
        this.stats.cacheMisses++;
        console.log(`[AssetManager] Loading: ${url} (type: ${type})`);

        const loadPromise = this.loadAsset(url, type, options);
        this.loading.set(url, loadPromise);

        try {
            const startTime = performance.now();
            const asset = await loadPromise;
            const loadTime = performance.now() - startTime;

            // Store in cache
            this.cache.set(url, asset);
            this.cacheOrder.push(url);

            // Store metadata
            this.metadata.set(url, {
                size: this.estimateSize(asset, type),
                loadTime,
                lastAccess: Date.now(),
                type,
                url,
            });

            this.stats.assetsLoaded++;
            this.stats.bytesLoaded += this.metadata.get(url).size;

            // Evict old assets if needed
            this.evictIfNeeded();

            console.log(`[AssetManager] Loaded: ${url} in ${loadTime.toFixed(2)}ms (cache: ${this.cache.size}/${this.maxCacheSize})`);

            return asset;
        } catch (error) {
            this.stats.loadErrors++;
            console.error(`[AssetManager] Failed to load: ${url}`, error);
            throw error;
        } finally {
            this.loading.delete(url);
        }
    }

    /**
     * Load asset based on type
     * @private
     */
    async loadAsset(url, type, options) {
        switch (type) {
        case 'image':
            return this.loadImage(url, options);
        case 'audio':
            return this.loadAudio(url, options);
        case 'json':
            return this.loadJSON(url, options);
        case 'text':
            return this.loadText(url, options);
        case 'blob':
            return this.loadBlob(url, options);
        default:
            throw new Error(`Unknown asset type: ${type}`);
        }
    }

    /**
     * Load an image
     */
    loadImage(url, options = {}) {
        return new Promise((resolve, reject) => {
            const img = new Image();

            if (options.crossOrigin) {
                img.crossOrigin = options.crossOrigin;
            }

            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error(`Failed to load image: ${url}`));

            img.src = url;
        });
    }

    /**
     * Load audio
     */
    loadAudio(url, options = {}) {
        return new Promise((resolve, reject) => {
            const audio = new Audio();

            audio.addEventListener('canplaythrough', () => resolve(audio), { once: true });
            audio.addEventListener('error', () => reject(new Error(`Failed to load audio: ${url}`)), { once: true });

            if (options.preload) {
                audio.preload = options.preload;
            }

            audio.src = url;
        });
    }

    /**
     * Load JSON
     */
    async loadJSON(url, options = {}) {
        const response = await fetch(url, options);

        if (!response.ok) {
            throw new Error(`Failed to load JSON: ${url} (${response.status})`);
        }

        return response.json();
    }

    /**
     * Load text
     */
    async loadText(url, options = {}) {
        const response = await fetch(url, options);

        if (!response.ok) {
            throw new Error(`Failed to load text: ${url} (${response.status})`);
        }

        return response.text();
    }

    /**
     * Load blob
     */
    async loadBlob(url, options = {}) {
        const response = await fetch(url, options);

        if (!response.ok) {
            throw new Error(`Failed to load blob: ${url} (${response.status})`);
        }

        return response.blob();
    }

    /**
     * Preload multiple assets
     * @param {Array} assets - Array of { url, type, options }
     * @returns {Promise<Array>} Array of loaded assets
     */
    async preload(assets) {
        console.log(`[AssetManager] Preloading ${assets.length} assets...`);
        const startTime = performance.now();

        const promises = assets.map((asset) => this.load(asset.url, asset.type || 'image', asset.options || {})
            .catch((error) => {
                console.error(`[AssetManager] Preload failed for ${asset.url}:`, error);
                return null; // Don't fail entire batch
            }));

        const results = await Promise.all(promises);
        const loadTime = performance.now() - startTime;
        const successful = results.filter((r) => r !== null).length;

        console.log(`[AssetManager] Preloaded ${successful}/${assets.length} assets in ${loadTime.toFixed(2)}ms`);

        return results;
    }

    /**
     * Update LRU order
     * @private
     */
    updateLRU(url) {
        const index = this.cacheOrder.indexOf(url);
        if (index > -1) {
            this.cacheOrder.splice(index, 1);
            this.cacheOrder.push(url);
        }
    }

    /**
     * Update last access time
     * @private
     */
    updateLastAccess(url) {
        const meta = this.metadata.get(url);
        if (meta) {
            meta.lastAccess = Date.now();
        }
    }

    /**
     * Estimate asset size in bytes
     * @private
     */
    estimateSize(asset, type) {
        switch (type) {
        case 'image':
            // Estimate: width * height * 4 bytes per pixel
            return (asset.width || 0) * (asset.height || 0) * 4;
        case 'audio':
            // Rough estimate: 1MB for audio
            return 1024 * 1024;
        case 'json':
        case 'text':
            // Estimate string length * 2 (UTF-16)
            return (JSON.stringify(asset).length || 0) * 2;
        case 'blob':
            return asset.size || 0;
        default:
            return 0;
        }
    }

    /**
     * Evict oldest assets if cache is full
     * @private
     */
    evictIfNeeded() {
        while (this.cache.size > this.maxCacheSize) {
            const oldestUrl = this.cacheOrder.shift();

            if (!oldestUrl) break;

            const asset = this.cache.get(oldestUrl);
            const meta = this.metadata.get(oldestUrl);

            console.log(`[AssetManager] Evicting: ${oldestUrl}`);

            // Clean up asset
            this.cleanupAsset(asset, meta?.type);

            // Remove from cache and metadata
            this.cache.delete(oldestUrl);
            this.metadata.delete(oldestUrl);

            this.stats.assetsEvicted++;
        }
    }

    /**
     * Clean up an asset before eviction
     * @private
     */
    cleanupAsset(asset, type) {
        if (!asset) return;

        switch (type) {
        case 'image':
            // Clear image src to free memory
            if (asset.src) {
                asset.src = '';
            }
            break;
        case 'audio':
            // Pause and clear audio
            if (asset.pause) {
                asset.pause();
            }
            if (asset.src) {
                asset.src = '';
            }
            break;
            // JSON, text, blob - garbage collected automatically
        }
    }

    /**
     * Check if asset is cached
     * @param {string} url - Asset URL
     * @returns {boolean}
     */
    has(url) {
        return this.cache.has(url);
    }

    /**
     * Get cached asset without loading
     * @param {string} url - Asset URL
     * @returns {*} Asset or undefined
     */
    get(url) {
        if (this.cache.has(url)) {
            this.updateLRU(url);
            this.updateLastAccess(url);
            return this.cache.get(url);
        }
        return undefined;
    }

    /**
     * Remove specific asset from cache
     * @param {string} url - Asset URL
     */
    remove(url) {
        const asset = this.cache.get(url);
        const meta = this.metadata.get(url);

        if (asset) {
            this.cleanupAsset(asset, meta?.type);
            this.cache.delete(url);
            this.metadata.delete(url);

            const index = this.cacheOrder.indexOf(url);
            if (index > -1) {
                this.cacheOrder.splice(index, 1);
            }

            console.log(`[AssetManager] Removed: ${url}`);
        }
    }

    /**
     * Clear all cached assets
     */
    clear() {
        console.log(`[AssetManager] Clearing ${this.cache.size} cached assets...`);

        // Clean up all assets
        for (const [url, asset] of this.cache.entries()) {
            const meta = this.metadata.get(url);
            this.cleanupAsset(asset, meta?.type);
        }

        this.cache.clear();
        this.metadata.clear();
        this.cacheOrder = [];
        this.loading.clear();

        console.log('✅ [AssetManager] Cache cleared');
    }

    /**
     * Get cache statistics
     * @returns {Object} Statistics object
     */
    getStats() {
        const totalBytes = Array.from(this.metadata.values())
            .reduce((sum, meta) => sum + meta.size, 0);

        const hitRate = this.stats.cacheHits + this.stats.cacheMisses > 0
            ? (this.stats.cacheHits / (this.stats.cacheHits + this.stats.cacheMisses) * 100).toFixed(2)
            : '0.00';

        return {
            ...this.stats,
            cacheSize: this.cache.size,
            maxCacheSize: this.maxCacheSize,
            totalBytes,
            totalMB: (totalBytes / 1024 / 1024).toFixed(2),
            hitRate: `${hitRate}%`,
            loading: this.loading.size,
        };
    }

    /**
     * Get detailed cache information
     * @returns {Array} Array of cached asset info
     */
    getCacheInfo() {
        return Array.from(this.cache.keys()).map((url) => {
            const meta = this.metadata.get(url);
            return {
                url,
                type: meta?.type,
                size: meta?.size,
                sizeMB: ((meta?.size || 0) / 1024 / 1024).toFixed(2),
                loadTime: meta?.loadTime?.toFixed(2),
                age: Date.now() - (meta?.lastAccess || 0),
                lruPosition: this.cacheOrder.indexOf(url),
            };
        });
    }

    /**
     * Log cache status to console
     */
    logStatus() {
        const stats = this.getStats();

        console.group('[AssetManager] Cache Status');
        console.log(`Cache: ${stats.cacheSize}/${stats.maxCacheSize} assets`);
        console.log(`Memory: ${stats.totalMB}MB`);
        console.log(`Hit Rate: ${stats.hitRate}`);
        console.log(`Loaded: ${stats.assetsLoaded}, Evicted: ${stats.assetsEvicted}, Errors: ${stats.loadErrors}`);
        console.log(`Currently Loading: ${stats.loading}`);
        console.table(this.getCacheInfo());
        console.groupEnd();
    }

    /**
     * Reset statistics
     */
    resetStats() {
        this.stats = {
            cacheHits: 0,
            cacheMisses: 0,
            assetsLoaded: 0,
            assetsEvicted: 0,
            bytesLoaded: 0,
            loadErrors: 0,
        };
        console.log('[AssetManager] Statistics reset');
    }
}

/**
 * Global singleton asset manager
 */
export const assetManager = new AssetManager({
    maxCacheSize: 50, // Configurable
});

// Expose to window for debugging
if (typeof window !== 'undefined') {
    window.assetManager = assetManager;
    console.log('💡 Asset manager available: window.assetManager.logStatus()');
}
