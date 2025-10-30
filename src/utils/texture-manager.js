/**
 * @fileoverview Texture Manager - GPU texture lifecycle management
 * 
 * Manages WebGL texture creation, caching, and disposal to prevent GPU memory leaks.
 * Tracks texture usage and ensures proper cleanup.
 * 
 * @example
 * import { TextureManager } from './utils/texture-manager.js';
 * 
 * const texManager = new TextureManager(gl);
 * 
 * // Load texture
 * const texture = await texManager.loadTexture('/assets/bg.jpg');
 * 
 * // Use texture...
 * 
 * // Clean up
 * texManager.cleanup();
 */

/**
 * Texture Manager - Manages WebGL texture lifecycle and GPU memory
 */
export class TextureManager {
    constructor(gl, options = {}) {
        this.gl = gl;
        this.textures = new Map(); // url -> { texture, width, height, timestamp }
        this.maxTextures = options.maxTextures || 20;
        this.textureOrder = []; // LRU tracking
        
        // Statistics
        this.stats = {
            texturesCreated: 0,
            texturesDeleted: 0,
            cacheHits: 0,
            cacheMisses: 0,
            totalGPUMemory: 0 // Estimated bytes
        };
        
        console.log(`[TextureManager] Initialized (max: ${this.maxTextures} textures)`);
    }

    /**
     * Load texture from URL
     * @param {string} url - Image URL
     * @param {Object} options - Texture options
     * @returns {Promise<WebGLTexture>}
     */
    async loadTexture(url, options = {}) {
        // Check cache first
        if (this.textures.has(url)) {
            this.stats.cacheHits++;
            this.updateLRU(url);
            console.log(`[TextureManager] Texture cache hit: ${url}`);
            return this.textures.get(url).texture;
        }

        this.stats.cacheMisses++;
        console.log(`[TextureManager] Loading texture: ${url}`);

        try {
            const startTime = performance.now();
            
            // Load image
            const image = await this.loadImage(url);
            
            // Create WebGL texture
            const texture = this.createTexture(image, options);
            
            const loadTime = performance.now() - startTime;
            const memorySize = this.estimateTextureSize(image.width, image.height);
            
            // Store in cache
            this.textures.set(url, {
                texture,
                width: image.width,
                height: image.height,
                timestamp: Date.now(),
                memorySize
            });
            
            this.textureOrder.push(url);
            this.stats.texturesCreated++;
            this.stats.totalGPUMemory += memorySize;
            
            console.log(`[TextureManager] Texture loaded: ${url} (${image.width}x${image.height}) in ${loadTime.toFixed(2)}ms`);
            console.log(`[TextureManager] GPU Memory: ${(this.stats.totalGPUMemory / 1024 / 1024).toFixed(2)}MB (${this.textures.size} textures)`);
            
            // Evict old textures if needed
            this.evictIfNeeded();
            
            return texture;
        } catch (error) {
            console.error(`[TextureManager] Failed to load texture: ${url}`, error);
            throw error;
        }
    }

    /**
     * Load image from URL
     * @private
     */
    loadImage(url) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
            img.src = url;
        });
    }

    /**
     * Create WebGL texture from image
     * @private
     */
    createTexture(image, options = {}) {
        const gl = this.gl;
        const texture = gl.createTexture();
        
        gl.bindTexture(gl.TEXTURE_2D, texture);
        
        // Set texture parameters
        const {
            wrapS = gl.CLAMP_TO_EDGE,
            wrapT = gl.CLAMP_TO_EDGE,
            minFilter = gl.LINEAR,
            magFilter = gl.LINEAR,
            generateMipmaps = false
        } = options;
        
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrapS);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrapT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, minFilter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, magFilter);
        
        // Upload image data
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
        
        // Generate mipmaps if requested
        if (generateMipmaps) {
            gl.generateMipmap(gl.TEXTURE_2D);
        }
        
        gl.bindTexture(gl.TEXTURE_2D, null);
        
        return texture;
    }

    /**
     * Create texture from canvas
     * @param {HTMLCanvasElement} canvas - Canvas element
     * @param {Object} options - Texture options
     * @returns {WebGLTexture}
     */
    createTextureFromCanvas(canvas, options = {}) {
        const key = `canvas_${Date.now()}_${Math.random()}`;
        
        const texture = this.createTexture(canvas, options);
        const memorySize = this.estimateTextureSize(canvas.width, canvas.height);
        
        this.textures.set(key, {
            texture,
            width: canvas.width,
            height: canvas.height,
            timestamp: Date.now(),
            memorySize
        });
        
        this.textureOrder.push(key);
        this.stats.texturesCreated++;
        this.stats.totalGPUMemory += memorySize;
        
        console.log(`[TextureManager] Canvas texture created: ${canvas.width}x${canvas.height}`);
        
        this.evictIfNeeded();
        
        return texture;
    }

    /**
     * Update LRU order
     * @private
     */
    updateLRU(url) {
        const index = this.textureOrder.indexOf(url);
        if (index > -1) {
            this.textureOrder.splice(index, 1);
            this.textureOrder.push(url);
        }
    }

    /**
     * Estimate texture memory size
     * @private
     */
    estimateTextureSize(width, height) {
        // RGBA = 4 bytes per pixel
        return width * height * 4;
    }

    /**
     * Evict oldest textures if cache is full
     * @private
     */
    evictIfNeeded() {
        while (this.textures.size > this.maxTextures) {
            const oldestUrl = this.textureOrder.shift();
            
            if (!oldestUrl) break;
            
            this.deleteTexture(oldestUrl);
        }
    }

    /**
     * Delete specific texture
     * @param {string} url - Texture URL or key
     */
    deleteTexture(url) {
        const entry = this.textures.get(url);
        
        if (entry) {
            // Delete WebGL texture
            this.gl.deleteTexture(entry.texture);
            
            // Update stats
            this.stats.texturesDeleted++;
            this.stats.totalGPUMemory -= entry.memorySize;
            
            // Remove from cache
            this.textures.delete(url);
            
            console.log(`[TextureManager] Texture deleted: ${url} (${this.textures.size} remaining)`);
        }
    }

    /**
     * Check if texture is cached
     * @param {string} url - Texture URL
     * @returns {boolean}
     */
    has(url) {
        return this.textures.has(url);
    }

    /**
     * Get cached texture
     * @param {string} url - Texture URL
     * @returns {WebGLTexture|null}
     */
    get(url) {
        const entry = this.textures.get(url);
        if (entry) {
            this.updateLRU(url);
            return entry.texture;
        }
        return null;
    }

    /**
     * Get texture info
     * @param {string} url - Texture URL
     * @returns {Object|null}
     */
    getInfo(url) {
        return this.textures.get(url) || null;
    }

    /**
     * Get all texture info
     * @returns {Array}
     */
    getAllInfo() {
        return Array.from(this.textures.entries()).map(([url, info]) => ({
            url,
            width: info.width,
            height: info.height,
            memoryMB: (info.memorySize / 1024 / 1024).toFixed(2),
            age: Date.now() - info.timestamp,
            lruPosition: this.textureOrder.indexOf(url)
        }));
    }

    /**
     * Get statistics
     * @returns {Object}
     */
    getStats() {
        return {
            ...this.stats,
            activeTextures: this.textures.size,
            maxTextures: this.maxTextures,
            memoryMB: (this.stats.totalGPUMemory / 1024 / 1024).toFixed(2),
            hitRate: this.stats.cacheHits + this.stats.cacheMisses > 0
                ? ((this.stats.cacheHits / (this.stats.cacheHits + this.stats.cacheMisses)) * 100).toFixed(2) + '%'
                : '0.00%'
        };
    }

    /**
     * Log status to console
     */
    logStatus() {
        const stats = this.getStats();
        
        console.group('[TextureManager] Status');
        console.log(`Textures: ${stats.activeTextures}/${stats.maxTextures}`);
        console.log(`GPU Memory: ${stats.memoryMB}MB`);
        console.log(`Created: ${stats.texturesCreated}, Deleted: ${stats.texturesDeleted}`);
        console.log(`Hit Rate: ${stats.hitRate}`);
        console.table(this.getAllInfo());
        console.groupEnd();
    }

    /**
     * Clean up all textures
     */
    cleanup() {
        console.log(`[TextureManager] Cleaning up ${this.textures.size} textures...`);
        
        // Delete all textures
        for (const [url, entry] of this.textures.entries()) {
            this.gl.deleteTexture(entry.texture);
        }
        
        // Clear tracking
        this.textures.clear();
        this.textureOrder = [];
        this.stats.totalGPUMemory = 0;
        
        console.log('✅ [TextureManager] All textures cleaned up');
    }
}

/**
 * Buffer Manager - Manages WebGL buffer lifecycle
 */
export class BufferManager {
    constructor(gl) {
        this.gl = gl;
        this.buffers = new Set(); // Track all created buffers
        
        this.stats = {
            buffersCreated: 0,
            buffersDeleted: 0
        };
        
        console.log('[BufferManager] Initialized');
    }

    /**
     * Create and track a buffer
     * @param {number} target - gl.ARRAY_BUFFER or gl.ELEMENT_ARRAY_BUFFER
     * @param {ArrayBuffer|TypedArray} data - Buffer data
     * @param {number} usage - gl.STATIC_DRAW, gl.DYNAMIC_DRAW, etc.
     * @returns {WebGLBuffer}
     */
    createBuffer(target, data, usage = this.gl.STATIC_DRAW) {
        const gl = this.gl;
        const buffer = gl.createBuffer();
        
        gl.bindBuffer(target, buffer);
        gl.bufferData(target, data, usage);
        gl.bindBuffer(target, null);
        
        // Track buffer
        this.buffers.add(buffer);
        this.stats.buffersCreated++;
        
        console.log(`[BufferManager] Buffer created (${this.buffers.size} active)`);
        
        return buffer;
    }

    /**
     * Delete specific buffer
     * @param {WebGLBuffer} buffer - Buffer to delete
     */
    deleteBuffer(buffer) {
        if (this.buffers.has(buffer)) {
            this.gl.deleteBuffer(buffer);
            this.buffers.delete(buffer);
            this.stats.buffersDeleted++;
            
            console.log(`[BufferManager] Buffer deleted (${this.buffers.size} remaining)`);
        }
    }

    /**
     * Get statistics
     * @returns {Object}
     */
    getStats() {
        return {
            ...this.stats,
            activeBuffers: this.buffers.size
        };
    }

    /**
     * Log status
     */
    logStatus() {
        const stats = this.getStats();
        
        console.group('[BufferManager] Status');
        console.log(`Active Buffers: ${stats.activeBuffers}`);
        console.log(`Created: ${stats.buffersCreated}, Deleted: ${stats.buffersDeleted}`);
        console.groupEnd();
    }

    /**
     * Clean up all buffers
     */
    cleanup() {
        console.log(`[BufferManager] Cleaning up ${this.buffers.size} buffers...`);
        
        for (const buffer of this.buffers) {
            this.gl.deleteBuffer(buffer);
        }
        
        this.buffers.clear();
        
        console.log('✅ [BufferManager] All buffers cleaned up');
    }
}

