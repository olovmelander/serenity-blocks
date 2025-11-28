/**
 * @fileoverview Render Batching System
 * Batches similar rendering operations to reduce draw calls
 * Phase 3 Architecture Improvement
 */

/**
 * Render batch manager for optimizing graphics operations
 * Groups similar operations to reduce overhead
 */
export class RenderBatch {
    constructor() {
        this.batches = {
            fillRect: [],
            strokeRect: [],
            circle: [],
            text: [],
        };

        this.stats = {
            batchedOperations: 0,
            drawCalls: 0,
        };
    }

    /**
     * Add a fill rectangle to batch
     * @param {Object} graphics - Phaser graphics object
     * @param {number} x - X position
     * @param {number} y - Y position
     * @param {number} width - Width
     * @param {number} height - Height
     * @param {number} color - Color (hex)
     * @param {number} alpha - Alpha (0-1)
     */
    addFillRect(graphics, x, y, width, height, color, alpha = 1.0) {
        this.batches.fillRect.push({
            graphics,
            x,
            y,
            width,
            height,
            color,
            alpha,
        });
    }

    /**
     * Add a stroke rectangle to batch
     * @param {Object} graphics - Phaser graphics object
     * @param {number} x - X position
     * @param {number} y - Y position
     * @param {number} width - Width
     * @param {number} height - Height
     * @param {number} color - Color (hex)
     * @param {number} lineWidth - Line width
     * @param {number} alpha - Alpha (0-1)
     */
    addStrokeRect(graphics, x, y, width, height, color, lineWidth = 1, alpha = 1.0) {
        this.batches.strokeRect.push({
            graphics,
            x,
            y,
            width,
            height,
            color,
            lineWidth,
            alpha,
        });
    }

    /**
     * Add a circle to batch
     * @param {Object} graphics - Phaser graphics object
     * @param {number} x - X position
     * @param {number} y - Y position
     * @param {number} radius - Radius
     * @param {number} color - Color (hex)
     * @param {number} alpha - Alpha (0-1)
     */
    addCircle(graphics, x, y, radius, color, alpha = 1.0) {
        this.batches.circle.push({
            graphics,
            x,
            y,
            radius,
            color,
            alpha,
        });
    }

    /**
     * Execute all batched operations
     */
    flush() {
        // Group by graphics object and color for efficiency
        this.flushFillRects();
        this.flushStrokeRects();
        this.flushCircles();

        // Clear batches
        this.clear();
    }

    /**
     * Flush fill rectangle batch
     */
    flushFillRects() {
        if (this.batches.fillRect.length === 0) return;

        // Group by graphics object and color/alpha
        const groups = new Map();

        this.batches.fillRect.forEach((rect) => {
            const key = `${rect.graphics.id || 'default'}-${rect.color}-${rect.alpha}`;
            if (!groups.has(key)) {
                groups.set(key, {
                    graphics: rect.graphics, color: rect.color, alpha: rect.alpha, rects: [],
                });
            }
            groups.get(key).rects.push(rect);
        });

        // Draw each group
        groups.forEach((group) => {
            group.graphics.fillStyle(group.color, group.alpha);
            group.rects.forEach((rect) => {
                group.graphics.fillRect(rect.x, rect.y, rect.width, rect.height);
            });
            this.stats.drawCalls++;
        });

        this.stats.batchedOperations += this.batches.fillRect.length;
    }

    /**
     * Flush stroke rectangle batch
     */
    flushStrokeRects() {
        if (this.batches.strokeRect.length === 0) return;

        // Group by graphics object and style
        const groups = new Map();

        this.batches.strokeRect.forEach((rect) => {
            const key = `${rect.graphics.id || 'default'}-${rect.color}-${rect.lineWidth}-${rect.alpha}`;
            if (!groups.has(key)) {
                groups.set(key, {
                    graphics: rect.graphics,
                    color: rect.color,
                    lineWidth: rect.lineWidth,
                    alpha: rect.alpha,
                    rects: [],
                });
            }
            groups.get(key).rects.push(rect);
        });

        // Draw each group
        groups.forEach((group) => {
            group.graphics.lineStyle(group.lineWidth, group.color, group.alpha);
            group.rects.forEach((rect) => {
                group.graphics.strokeRect(rect.x, rect.y, rect.width, rect.height);
            });
            this.stats.drawCalls++;
        });

        this.stats.batchedOperations += this.batches.strokeRect.length;
    }

    /**
     * Flush circle batch
     */
    flushCircles() {
        if (this.batches.circle.length === 0) return;

        // Group by graphics object and color/alpha
        const groups = new Map();

        this.batches.circle.forEach((circle) => {
            const key = `${circle.graphics.id || 'default'}-${circle.color}-${circle.alpha}`;
            if (!groups.has(key)) {
                groups.set(key, {
                    graphics: circle.graphics, color: circle.color, alpha: circle.alpha, circles: [],
                });
            }
            groups.get(key).circles.push(circle);
        });

        // Draw each group
        groups.forEach((group) => {
            group.graphics.fillStyle(group.color, group.alpha);
            group.circles.forEach((circle) => {
                group.graphics.fillCircle(circle.x, circle.y, circle.radius);
            });
            this.stats.drawCalls++;
        });

        this.stats.batchedOperations += this.batches.circle.length;
    }

    /**
     * Clear all batches
     */
    clear() {
        this.batches.fillRect = [];
        this.batches.strokeRect = [];
        this.batches.circle = [];
        this.batches.text = [];
    }

    /**
     * Get batch statistics
     * @returns {Object} Stats
     */
    getStats() {
        return {
            ...this.stats,
            pending: {
                fillRect: this.batches.fillRect.length,
                strokeRect: this.batches.strokeRect.length,
                circle: this.batches.circle.length,
                text: this.batches.text.length,
            },
        };
    }

    /**
     * Reset statistics
     */
    resetStats() {
        this.stats.batchedOperations = 0;
        this.stats.drawCalls = 0;
    }
}

/**
 * Offscreen canvas manager for pre-rendering static content
 */
export class OffscreenCanvasManager {
    constructor() {
        this.canvases = new Map();
    }

    /**
     * Create or get an offscreen canvas
     * @param {string} key - Canvas identifier
     * @param {number} width - Canvas width
     * @param {number} height - Canvas height
     * @returns {Object} Canvas and context
     */
    getCanvas(key, width, height) {
        if (!this.canvases.has(key)) {
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');

            this.canvases.set(key, {
                canvas, ctx, width, height,
            });
        }

        return this.canvases.get(key);
    }

    /**
     * Pre-render content to offscreen canvas
     * @param {string} key - Canvas identifier
     * @param {number} width - Canvas width
     * @param {number} height - Canvas height
     * @param {Function} renderFn - Function to render content
     * @returns {HTMLCanvasElement} Offscreen canvas
     */
    preRender(key, width, height, renderFn) {
        const { canvas, ctx } = this.getCanvas(key, width, height);

        // Clear canvas
        ctx.clearRect(0, 0, width, height);

        // Render content
        renderFn(ctx, canvas);

        return canvas;
    }

    /**
     * Clear a cached canvas
     * @param {string} key - Canvas identifier
     */
    clearCanvas(key) {
        const entry = this.canvases.get(key);
        if (entry) {
            entry.ctx.clearRect(0, 0, entry.width, entry.height);
        }
    }

    /**
     * Remove a canvas
     * @param {string} key - Canvas identifier
     */
    removeCanvas(key) {
        this.canvases.delete(key);
    }

    /**
     * Clear all canvases
     */
    clearAll() {
        this.canvases.forEach((entry) => {
            entry.ctx.clearRect(0, 0, entry.width, entry.height);
        });
    }

    /**
     * Get cache size
     * @returns {number} Number of cached canvases
     */
    size() {
        return this.canvases.size;
    }
}

// Export singleton instances
export const renderBatch = new RenderBatch();
export const offscreenCanvasManager = new OffscreenCanvasManager();

// Expose for debugging
if (typeof window !== 'undefined') {
    window.renderOptimizer = {
        batch: renderBatch,
        offscreen: offscreenCanvasManager,

        // Debug commands
        status: () => {
            console.group('Render Optimizer Status');
            console.log('Batch Stats:', renderBatch.getStats());
            console.log('Offscreen Canvases:', offscreenCanvasManager.size());
            console.groupEnd();
        },

        reset: () => {
            renderBatch.clear();
            renderBatch.resetStats();
            console.log('Render batch reset');
        },
    };

    console.log('💡 Render optimizer available:');
    console.log('  window.renderOptimizer.status() - View rendering stats');
    console.log('  window.renderOptimizer.reset()  - Reset batch statistics');
}
