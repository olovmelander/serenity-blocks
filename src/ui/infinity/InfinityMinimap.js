/**
 * @fileoverview Infinity Mode Minimap Component
 * Displays an overview of the entire 1000-row build with viewport indicator
 * Allows click-to-jump navigation and shows height milestones
 */

import { calculateTopRow, calculateBuildHeight } from '../../core/infinity-grid.js';

/**
 * InfinityMinimap - Visual overview of entire build
 *
 * Features:
 * - Shows entire grid (up to 1000 rows)
 * - Current viewport indicator
 * - Click-to-jump navigation
 * - Height milestone markers (100, 250, 500, 750, 1000)
 * - Auto-scrolls during gameplay
 */
export class InfinityMinimap {
    /**
     * Create minimap component
     * @param {Object} options - Configuration options
     * @param {HTMLElement} options.container - Container element for minimap
     * @param {number} options.width - Minimap width in pixels (default: 60)
     * @param {number} options.height - Minimap height in pixels (default: 400)
     */
    constructor(options = {}) {
        this.options = {
            width: options.width || 180,
            height: options.height || 420,
            container: options.container || null,
        };

        // Canvas for rendering
        this.canvas = null;
        this.ctx = null;

        // Game state reference
        this.gameState = null;

        // Camera position tracking
        this.cameraRow = 0;
        this.visibleRows = 20;

        // Interaction state
        this.isDragging = false;
        this.isHovering = false;

        // Height milestones
        this.milestones = [100, 250, 500, 750, 1000];

        // PERFORMANCE: Dirty flag system to prevent unnecessary redraws
        // Only render when something actually changed
        this.lastCameraRow = null;
        this.lastBuildHeight = null;
        this.lastTopRow = null;
        this.lastLockedPiecesCount = 0;

        // PERFORMANCE: Time-based throttling to prevent excessive renders
        // Minimap doesn't need to update 60 times per second!
        this.lastUpdateTime = 0;
        this.updateInterval = 100; // Update every 100ms (10fps max)

        // Bind event handlers
        this.handleClick = this._onClick.bind(this);
        this.handleMouseDown = this._onMouseDown.bind(this);
        this.handleMouseMove = this._onMouseMove.bind(this);
        this.handleMouseUp = this._onMouseUp.bind(this);
        this.handleMouseEnter = this._onMouseEnter.bind(this);
        this.handleMouseLeave = this._onMouseLeave.bind(this);

        // Initialize
        this._initialize();
    }

    /**
     * Initialize minimap
     * @private
     */
    _initialize() {
        // Create minimap container
        this.container = document.createElement('div');
        this.container.id = 'infinity-minimap';
        this.container.className = 'infinity-minimap';
        this.container.style.cssText = `
            position: relative;
            width: ${this.options.width}px;
            height: ${this.options.height}px;
            background: linear-gradient(180deg, rgba(6, 10, 24, 0.92), rgba(4, 6, 18, 0.92));
            border: 2px solid rgba(100, 255, 200, 0.35);
            border-radius: 16px;
            padding: 12px;
            box-shadow:
                0 14px 40px rgba(10, 16, 30, 0.5),
                inset 0 0 24px rgba(60, 255, 200, 0.2);
            cursor: pointer;
            margin-top: 0;
            display: none;
            box-sizing: border-box;
        `;

        // Create canvas
        this.canvas = document.createElement('canvas');
        this.canvas.width = this.options.width - 24; // Account for padding
        this.canvas.height = this.options.height - 32;
        this.canvas.style.cssText = `
            display: block;
            image-rendering: pixelated;
            margin: 12px auto 0 auto;
            border-radius: 10px;
            background: rgba(10, 18, 40, 0.85);
        `;

        this.ctx = this.canvas.getContext('2d');
        this.container.appendChild(this.canvas);

        // Create title label
        const title = document.createElement('div');
        title.className = 'minimap-title';
        title.textContent = 'OVERVIEW';
        title.style.cssText = `
            text-align: center;
            font-family: 'Orbitron', monospace;
            text-align: center;
            font-size: 10px;
            font-weight: 600;
            color: rgba(255, 255, 255, 0.6);
            letter-spacing: 1px;
            margin-bottom: 12px;
            text-transform: uppercase;
        `;
        this.container.appendChild(title);

        // Add event listeners
        this.canvas.addEventListener('click', this.handleClick);
        this.canvas.addEventListener('mousedown', this.handleMouseDown);
        this.canvas.addEventListener('mousemove', this.handleMouseMove);
        this.canvas.addEventListener('mouseup', this.handleMouseUp);
        this.canvas.addEventListener('mouseenter', this.handleMouseEnter);
        this.canvas.addEventListener('mouseleave', this.handleMouseLeave);

        console.log('[InfinityMinimap] Initialized');
    }

    /**
     * Show minimap
     */
    show() {
        const panel = document.getElementById('single-player-container');

        if (panel && this.container.parentElement !== panel) {
            panel.appendChild(this.container);
        }

        this.container.style.display = 'block';
        console.log('[InfinityMinimap] Shown');
    }

    /**
     * Hide minimap
     */
    hide() {
        this.container.style.display = 'none';
        console.log('[InfinityMinimap] Hidden');
    }

    /**
     * Update minimap with current game state
     * PERFORMANCE OPTIMIZED: Only renders when state actually changes
     * @param {Object} gameState - Current game state
     * @param {number} cameraRow - Current camera row position
     * @param {number} visibleRows - Number of visible rows in viewport
     */
    update(gameState, cameraRow, visibleRows) {
        if (!gameState) return;

        // PERFORMANCE CRITICAL: Time-based throttling
        // Don't even check for changes more than 10 times per second
        const now = performance.now();
        if (now - this.lastUpdateTime < this.updateInterval) {
            return; // Skip this update entirely
        }

        // PERFORMANCE: Calculate current state values ONLY after throttle check
        const buildHeight = calculateBuildHeight(gameState);
        const topRow = calculateTopRow(gameState);
        const lockedPiecesCount = gameState.lockedPieces?.length || 0;

        // PERFORMANCE: Only render if something actually changed
        // Note: lockedPiecesCount changes every piece, so we use larger intervals
        const shouldRender =
            this.lastCameraRow !== cameraRow ||
            this.lastBuildHeight !== buildHeight ||
            this.lastTopRow !== topRow ||
            this.lastLockedPiecesCount !== lockedPiecesCount ||
            this.gameState === null; // First render

        if (shouldRender) {
            this.gameState = gameState;
            this.cameraRow = cameraRow;
            this.visibleRows = visibleRows;

            // Cache current values
            this.lastCameraRow = cameraRow;
            this.lastBuildHeight = buildHeight;
            this.lastTopRow = topRow;
            this.lastLockedPiecesCount = lockedPiecesCount;
            this.lastUpdateTime = now; // Update timestamp only when we actually render

            this.render();
        }
    }

    /**
     * Render minimap
     * @private
     */
    render() {
        if (!this.gameState || !this.ctx) return;

        const { width, height } = this.canvas;
        const ctx = this.ctx;

        // Clear canvas
        ctx.clearRect(0, 0, width, height);

        // Draw background
        ctx.fillStyle = 'rgba(20, 20, 30, 0.8)';
        ctx.fillRect(0, 0, width, height);

        const totalRows = this.gameState.board.length;
        const pixelsPerRow = height / totalRows;

        // Draw height milestones
        this._drawMilestones(ctx, width, height, totalRows, pixelsPerRow);

        // Draw row labels
        this._drawRowLabels(ctx, width, height, totalRows, pixelsPerRow);

        // Draw build (blocks)
        this._drawBuild(ctx, width, height, totalRows, pixelsPerRow);

        // Draw viewport indicator
        this._drawViewport(ctx, width, height, totalRows, pixelsPerRow);

        // Draw top row indicator
        this._drawTopRowIndicator(ctx, width, height, totalRows, pixelsPerRow);
    }

    /**
     * Draw height milestone markers
     * CORRECTED: Row 0 at TOP, Row 1000 at BOTTOM
     * @private
     */
    _drawMilestones(ctx, width, height, totalRows, pixelsPerRow) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.lineWidth = 1;
        ctx.font = '8px monospace';
        ctx.textAlign = 'right';

        this.milestones.forEach(milestone => {
            if (milestone <= totalRows) {
                // Row 0 at top (y=0), Row 1000 at bottom (y=height)
                const y = milestone * pixelsPerRow;

                // Draw line
                ctx.beginPath();
                ctx.moveTo(0, y);
                ctx.lineTo(width, y);
                ctx.stroke();

                // Draw label (only if not at edges)
                if (y > 10 && y < height - 10) {
                    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
                    ctx.fillText(milestone.toString(), width - 2, y + 3);
                }
            }
        });
    }

    /**
     * Draw row number labels
     * CORRECTED: Row 0 at TOP, Row 1000 at BOTTOM
     * @private
     */
    _drawRowLabels(ctx, width, height, totalRows, pixelsPerRow) {
        const labels = [
            { row: 0, text: '0', color: '#ff0000' },      // Top (goal)
            { row: 250, text: '250', color: '#ffff00' },
            { row: 500, text: '500', color: '#ffff00' },
            { row: 750, text: '750', color: '#ffff00' },
            { row: 1000, text: '1000', color: '#00ff00' }, // Bottom (start)
        ];

        ctx.font = '10px monospace';
        ctx.textAlign = 'right';

        labels.forEach(({ row, text, color }) => {
            if (row <= totalRows) {
                // Row 0 at top (y=0), Row 1000 at bottom (y=height)
                const y = row * pixelsPerRow;

                // Background for readability
                ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
                ctx.fillRect(width - 30, y - 6, 28, 12);

                // Text
                ctx.fillStyle = color;
                ctx.fillText(text, width - 2, y + 3);
            }
        });
    }

    /**
     * Draw build (all placed blocks)
     * @private
     */
    _drawBuild(ctx, width, height, totalRows, pixelsPerRow) {
        const board = this.gameState.board;

        // Sample blocks for minimap (can't draw every single block at this scale)
        // Draw a simplified representation using actual row positions
        const topRow = calculateTopRow(this.gameState);

        // Only draw if there are blocks on the board
        if (topRow >= totalRows) {
            // No blocks yet
            return;
        }

        // Draw filled area from topRow (in row coordinates) to bottom
        // topRow is the row index, so Y position = topRow * pixelsPerRow
        const topY = topRow * pixelsPerRow;
        const bottomY = totalRows * pixelsPerRow;
        const fillHeight = bottomY - topY;

        // Create gradient for depth effect
        const gradient = ctx.createLinearGradient(0, topY, 0, bottomY);
        gradient.addColorStop(0, 'rgba(100, 200, 255, 0.6)');
        gradient.addColorStop(1, 'rgba(50, 100, 200, 0.8)');

        ctx.fillStyle = gradient;
        ctx.fillRect(2, topY, width - 4, fillHeight);

        // Add outline
        ctx.strokeStyle = 'rgba(150, 220, 255, 0.8)';
        ctx.lineWidth = 1;
        ctx.strokeRect(2, topY, width - 4, fillHeight);
    }

    /**
     * Draw viewport indicator (current camera view)
     * CORRECTED: Row 0 at TOP, Row 1000 at BOTTOM
     * cameraRow represents the TOP of the viewport
     * @private
     */
    _drawViewport(ctx, width, height, totalRows, pixelsPerRow) {
        // Calculate viewport position
        // cameraRow is the TOP row of the viewport
        const viewportTopRow = this.cameraRow;
        const viewportBottomRow = this.cameraRow + this.visibleRows;

        // Row 0 at top (y=0), so viewportTopRow maps directly to Y
        const viewportY = viewportTopRow * pixelsPerRow;
        const viewportHeight = this.visibleRows * pixelsPerRow;

        // Darken areas outside viewport
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';

        // Area ABOVE viewport (rows 0 to viewportTopRow - not yet reached)
        ctx.fillRect(0, 0, width, viewportY);

        // Area BELOW viewport (rows below viewport bottom)
        const belowY = viewportY + viewportHeight;
        const belowHeight = height - belowY;
        if (belowHeight > 0) {
            ctx.fillRect(0, belowY, width, belowHeight);
        }

        // Highlight viewport area
        ctx.fillStyle = 'rgba(0, 255, 0, 0.15)'; // Subtle green tint
        ctx.fillRect(0, viewportY, width, viewportHeight);

        // Draw viewport border (bright green)
        ctx.strokeStyle = '#00ff00';
        ctx.lineWidth = 2;
        ctx.strokeRect(0, viewportY, width, viewportHeight);

        // Draw scroll arrow indicator
        this._drawScrollArrow(ctx, width, viewportY + viewportHeight / 2);
    }

    /**
     * Draw top row indicator (highest block)
     * CORRECTED: Row 0 at TOP, Row 1000 at BOTTOM
     * @private
     */
    _drawTopRowIndicator(ctx, width, height, totalRows, pixelsPerRow) {
        const topRow = calculateTopRow(this.gameState);
        // Row 0 at top (y=0), so topRow maps directly to Y
        const topRowY = topRow * pixelsPerRow;

        // Draw indicator line
        ctx.strokeStyle = 'rgba(255, 100, 100, 0.8)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, topRowY);
        ctx.lineTo(width, topRowY);
        ctx.stroke();

        // Draw arrow indicator
        ctx.fillStyle = 'rgba(255, 100, 100, 0.8)';
        ctx.beginPath();
        ctx.moveTo(width - 2, topRowY); // Point
        ctx.lineTo(width - 7, topRowY - 3); // Top
        ctx.lineTo(width - 7, topRowY + 3); // Bottom
        ctx.closePath();
        ctx.fill();
    }

    /**
     * Handle click to jump to position
     * @private
     */
    _onClick(event) {
        const rect = this.canvas.getBoundingClientRect();
        const y = event.clientY - rect.top;
        const targetRow = this._getRowFromY(y);

        console.log('[InfinityMinimap] Clicked, jumping to row:', targetRow);

        // Dispatch event for camera to jump
        this.container.dispatchEvent(new CustomEvent('minimap-jump', {
            detail: { targetRow },
            bubbles: true,
        }));
    }

    /**
     * Handle mouse down (start dragging)
     * @private
     */
    _onMouseDown(event) {
        this.isDragging = true;
        this._onClick(event); // Also trigger jump on mouse down
    }

    /**
     * Handle mouse move (dragging)
     * @private
     */
    _onMouseMove(event) {
        if (this.isDragging) {
            this._onClick(event);
        }
    }

    /**
     * Handle mouse up (stop dragging)
     * @private
     */
    _onMouseUp() {
        this.isDragging = false;
    }

    /**
     * Handle mouse enter
     * @private
     */
    _onMouseEnter() {
        this.isHovering = true;
        this.canvas.style.opacity = '1.0';
    }

    /**
     * Handle mouse leave
     * @private
     */
    _onMouseLeave() {
        this.isHovering = false;
        this.isDragging = false;
        this.canvas.style.opacity = '0.8';
    }

    /**
     * Helper: Draw arrow showing current viewport
     * @private
     */
    _drawScrollArrow(ctx, width, centerY) {
        const arrowSize = 5;

        ctx.fillStyle = '#00ff00';
        ctx.beginPath();
        ctx.moveTo(-2, centerY); // Point
        ctx.lineTo(-2 - arrowSize, centerY - arrowSize); // Top
        ctx.lineTo(-2 - arrowSize, centerY + arrowSize); // Bottom
        ctx.closePath();
        ctx.fill();
    }

    /**
     * Get row from Y coordinate on minimap
     * Returns the CENTER row of where the user clicked
     * @private
     * @param {number} y - Y coordinate on canvas
     * @returns {number} - Row index at center of clicked position
     */
    _getRowFromY(y) {
        const totalRows = this.gameState.board.length;
        const pixelsPerRow = this.canvas.height / totalRows;

        // Convert Y to row - direct mapping (top = row 0, bottom = row totalRows)
        // This gives us the row that was clicked
        const clickedRow = Math.floor(y / pixelsPerRow);

        // Return the clicked row, which will be used as the center point
        // The minimap handler will calculate the appropriate camera top position
        return Math.max(0, Math.min(totalRows - 1, clickedRow));
    }

    /**
     * Destroy minimap and clean up
     */
    destroy() {
        // Remove event listeners
        this.canvas.removeEventListener('click', this.handleClick);
        this.canvas.removeEventListener('mousedown', this.handleMouseDown);
        this.canvas.removeEventListener('mousemove', this.handleMouseMove);
        this.canvas.removeEventListener('mouseup', this.handleMouseUp);
        this.canvas.removeEventListener('mouseenter', this.handleMouseEnter);
        this.canvas.removeEventListener('mouseleave', this.handleMouseLeave);

        // Remove from DOM
        if (this.container.parentElement) {
            this.container.parentElement.removeChild(this.container);
        }

        console.log('[InfinityMinimap] Destroyed');
    }
}
