/**
 * @fileoverview Infinity Mode Minimap Component
 * Displays an overview of the Infinity build with viewport indicator
 * Allows click-to-jump navigation and shows height milestones
 */

import { calculateTopRow } from '../../core/infinity-grid.js';

/**
 * InfinityMinimap - Visual overview of entire build
 *
 * Features:
 * - Shows entire grid (up to configured max rows)
 * - Current viewport indicator
 * - Click-to-jump navigation
 * - Height milestone markers (scaled to max rows)
 * - Auto-scrolls during gameplay
 */
export class InfinityMinimap {
    /**
     * Create minimap component
     * @param {Object} options - Configuration options
     * @param {HTMLElement} options.container - Container element for minimap
     * @param {number} options.width - Minimap width in pixels (default: 60)
     * @param {number} options.height - Minimap height in pixels (default: 400)
     * @param {number} options.maxRows - Max rows to render (default: 1000)
     */
    constructor(options = {}) {
        this.options = {
            width: options.width || 180,
            height: options.height || 420,
            container: options.container || null,
            id: options.id || null,
            maxRows: options.maxRows || 1000,
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

        // Exploration mode state (drag-to-explore)
        this.isExploring = false; // True when actively exploring (drag threshold met)
        this.dragStartY = null; // Y position where drag started
        this.dragThreshold = 8; // Minimum pixels before entering exploration mode

        // Mouse position for cursor glow effect
        this.mouseX = 50; // Center by default (percentage)
        this.mouseY = 50;

        // Height milestones (computed from maxRows)
        this.milestones = [];

        // Static raster layers sit on either side of the animated scanline.
        // The visible canvas still renders its scanline and viewport pulse every 16ms.
        this.backgroundLayer = null;
        this.crtLayer = null;
        this.labelLayout = null;
        this.buildFill = null;
        this.lastBorderColor = null;
        this.lastGlowColor = null;
        this.lastProgressTopRow = null;
        this.lastProgressMaxRows = null;
        this.hideTimeout = null;

        // PERFORMANCE: Time-based throttling to prevent excessive renders
        // Note: Using 16ms (~60fps) to support smooth pulsing animation
        this.lastUpdateTime = 0;
        this.updateInterval = 16; // Update every ~16ms for smooth animations

        // Bind event handlers
        this.handleClick = this._onClick.bind(this);
        this.handleMouseDown = this._onMouseDown.bind(this);
        this.handleMouseMove = this._onMouseMove.bind(this);
        this.handleMouseUp = this._onMouseUp.bind(this);
        this.handleMouseEnter = this._onMouseEnter.bind(this);
        this.handleMouseLeave = this._onMouseLeave.bind(this);
        this.handleContainerMouseMove = this._onContainerMouseMove.bind(this);
        this.handleContainerMouseLeave = this._onContainerMouseLeave.bind(this);

        // Global event handlers for drag operations
        this.handleWindowMouseUp = this._onWindowMouseUp.bind(this);
        this.handleWindowMouseMove = this._onWindowMouseMove.bind(this);

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
        if (this.options.id) {
            this.container.id = this.options.id;
        } else if (!this.options.container) {
            this.container.id = 'infinity-minimap';
        }
        this.container.className = 'infinity-minimap';
        this.container.style.cssText = `
            position: relative;
            width: ${this.options.width}px;
            height: ${this.options.height}px;
            background: linear-gradient(
                165deg,
                rgba(10, 25, 40, 0.92) 0%,
                rgba(5, 15, 30, 0.95) 50%,
                rgba(2, 8, 20, 0.98) 100%
            );
            border: 1px solid rgba(167, 139, 250, 0.25);
            border-radius: 20px;
            padding: 12px 12px 16px 12px;
            box-shadow:
                0 8px 32px rgba(0, 0, 0, 0.5),
                inset 0 0 24px rgba(167, 139, 250, 0.05),
                0 0 60px rgba(167, 139, 250, 0.08);
            cursor: pointer;
            margin-top: 0;
            display: none;
            box-sizing: border-box;
            opacity: 0.96;
            transform-origin: top right;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        `;

        // Create canvas (will be appended after title)
        this.canvas = document.createElement('canvas');
        this.canvas.width = this.options.width - 24; // Account for padding
        this.canvas.height = this.options.height - 62; // Account for padding, title, and instruction
        this.canvas.style.cssText = `
            display: block;
            image-rendering: pixelated;
            margin: 0 auto;
            border-radius: 12px;
            background: rgba(5, 10, 24, 0.85);
            transition: opacity 0.3s ease;
        `;

        this.ctx = this.canvas.getContext('2d');

        // Add animations and hover styles
        if (!document.getElementById('infinity-minimap-styles')) {
            const hoverStyle = document.createElement('style');
            hoverStyle.id = 'infinity-minimap-styles';
            hoverStyle.textContent = `
            /* Slide-in animation from right with spring effect */
            @keyframes minimapSlideIn {
                0% {
                    transform: translateX(120%) scale(0.95);
                    opacity: 0;
                }
                60% {
                    transform: translateX(-8px) scale(1.02);
                    opacity: 1;
                }
                100% {
                    transform: translateX(0) scale(1);
                    opacity: 0.96;
                }
            }

            /* Slide-out animation */
            @keyframes minimapSlideOut {
                0% {
                    transform: translateX(0) scale(1);
                    opacity: 0.96;
                }
                100% {
                    transform: translateX(120%) scale(0.95);
                    opacity: 0;
                }
            }

            /* Activation pulse ripple effect */
            @keyframes activationPulse {
                0% {
                    box-shadow:
                        0 8px 32px rgba(0, 0, 0, 0.5),
                        inset 0 0 24px rgba(167, 139, 250, 0.05),
                        0 0 0 0 rgba(167, 139, 250, 0.7);
                }
                50% {
                    box-shadow:
                        0 8px 32px rgba(0, 0, 0, 0.5),
                        inset 0 0 40px rgba(167, 139, 250, 0.4),
                        0 0 30px 15px rgba(167, 139, 250, 0);
                }
                100% {
                    box-shadow:
                        0 8px 32px rgba(0, 0, 0, 0.5),
                        inset 0 0 24px rgba(167, 139, 250, 0.05),
                        0 0 0 0 rgba(167, 139, 250, 0);
                }
            }

            /* Enhanced border pulse for active state */
            @keyframes borderPulseActive {
                0%, 100% {
                    border-color: rgba(167, 139, 250, 0.25);
                }
                50% {
                    border-color: rgba(167, 139, 250, 0.6);
                }
            }

            .infinity-minimap:hover {
                opacity: 1 !important;
                transform: scale(1.02) !important;
                border-color: rgba(167, 139, 250, 0.5) !important;
                box-shadow:
                    0 12px 40px rgba(0, 0, 0, 0.6),
                    inset 0 0 32px rgba(167, 139, 250, 0.2),
                    0 0 40px rgba(167, 139, 250, 0.2) !important;
            }

            .infinity-minimap:active {
                transform: scale(0.98) !important;
            }

            /* Active state while minimap is visible */
            .infinity-minimap.active {
                animation: borderPulseActive 3s ease-in-out infinite;
            }

            /* Enhanced title glow when active */
            .infinity-minimap.active .minimap-title {
                color: rgba(167, 139, 250, 0.9) !important;
                text-shadow: 0 0 10px rgba(167, 139, 250, 0.5);
            }
        `;
            document.head.appendChild(hoverStyle);
        }

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
            color: rgba(167, 139, 250, 0.8);
            letter-spacing: 1px;
            margin-bottom: 12px;
            text-transform: uppercase;
            transition: color 0.3s ease, opacity 0.3s ease;
        `;
        // Append elements in order: title, canvas, instruction
        this.container.appendChild(title);
        this.container.appendChild(this.canvas);

        // Create instruction label at bottom
        this.instructionLabel = document.createElement('div');
        this.instructionLabel.className = 'minimap-instruction';
        this.instructionLabel.textContent = 'Drag to explore';
        this.instructionLabel.style.cssText = `
            text-align: center;
            font-family: 'Orbitron', monospace;
            font-size: 9px;
            font-weight: 400;
            color: rgba(167, 139, 250, 0.5);
            letter-spacing: 0.5px;
            margin-top: 8px;
            margin-bottom: 4px;
            text-transform: uppercase;
            transition: color 0.3s ease, opacity 0.3s ease;
        `;
        this.container.appendChild(this.instructionLabel);

        // Add event listeners
        this.canvas.addEventListener('click', this.handleClick);
        this.canvas.addEventListener('mousedown', this.handleMouseDown);
        this.canvas.addEventListener('mousemove', this.handleMouseMove);
        this.canvas.addEventListener('mouseup', this.handleMouseUp);
        this.canvas.addEventListener('mouseenter', this.handleMouseEnter);
        this.canvas.addEventListener('mouseleave', this.handleMouseLeave);

        // Add container-level mousemove for cursor glow effect
        this.container.addEventListener('mousemove', this.handleContainerMouseMove);
        this.container.addEventListener('mouseleave', this.handleContainerMouseLeave);

        console.log('[InfinityMinimap] Initialized');
    }

    /**
     * Show minimap (always visible, no entrance animation)
     */
    show() {
        clearTimeout(this.hideTimeout);
        this.hideTimeout = null;
        const host = this.options.container || document.getElementById('single-player-container');

        if (host && this.container.parentElement !== host) {
            host.appendChild(this.container);
        }

        // Simply show without animation
        this.container.style.display = 'block';
        this.container.style.transform = 'translateX(0) scale(1)';
        this.container.style.opacity = '0.8';

        // Hidden updates retain the latest model without raster work.
        this.render();

        console.log('[InfinityMinimap] Shown');
    }

    /**
     * Hide minimap with animated exit
     */
    hide() {
        // Remove active class
        this.container.classList.remove('active');

        // Apply slide-out animation
        this.container.style.animation = 'minimapSlideOut 0.4s cubic-bezier(0.55, 0.085, 0.68, 0.53) forwards';

        // Trigger activation pulse on close
        this._triggerActivationPulse();

        // Actually hide after animation completes
        clearTimeout(this.hideTimeout);
        this.hideTimeout = setTimeout(() => {
            this.container.style.display = 'none';
            this.container.style.animation = 'none';
            this.hideTimeout = null;
        }, 400);

        console.log('[InfinityMinimap] Hidden with animation');
    }

    /**
     * Trigger activation pulse effect
     * @private
     */
    _triggerActivationPulse() {
        // Temporarily remove the active class to allow the pulse to trigger
        const wasActive = this.container.classList.contains('active');
        if (wasActive) {
            this.container.classList.remove('active');
        }

        // Force a reflow to ensure the animation restarts
        void this.container.offsetWidth;

        // Apply the activation pulse
        this.container.style.animation = 'activationPulse 0.6s ease-out';

        // After the pulse completes, restore active state if needed
        setTimeout(() => {
            this.container.style.animation = '';
            if (wasActive) {
                this.container.classList.add('active');
            }
        }, 600);
    }

    /**
     * Trigger pause highlight effect (called when game is paused)
     * Makes the minimap visually react to indicate it's now interactive
     */
    onPause() {
        // Trigger immediate activation pulse for instant feedback
        this._triggerActivationPulse();

        // Add active class for continuous pulse (will be restored after pulse animation)
        // The _triggerActivationPulse will handle adding it back after the pulse
        setTimeout(() => {
            this.container.classList.add('active');
        }, 650); // Slightly after pulse completes

        console.log('[InfinityMinimap] Pause highlight activated');
    }

    /**
     * Trigger unpause effect (called when game resumes)
     * Subtle farewell animation
     */
    onUnpause() {
        // Trigger pulse before removing active class
        this._triggerActivationPulse();

        // Remove active class (stops continuous pulse) - will be handled by _triggerActivationPulse
        setTimeout(() => {
            this.container.classList.remove('active');
        }, 650);

        console.log('[InfinityMinimap] Unpause effect triggered');
    }

    /**
     * Update minimap with current game state
     * Static layers are reused while scanline and viewport animations remain live.
     * @param {Object} gameState - Current game state
     * @param {number} cameraRow - Current camera row position
     * @param {number} visibleRows - Number of visible rows in viewport
     */
    update(gameState, cameraRow, visibleRows) {
        if (!gameState) return;

        this.gameState = gameState;
        this.cameraRow = cameraRow;
        this.visibleRows = visibleRows;

        // Keep the latest state for reopening, but skip all hidden canvas work.
        if (this.container.style.display === 'none') return;

        // PERFORMANCE CRITICAL: Time-based throttling
        // Keep the existing 16ms animation cadence.
        const now = performance.now();
        if (now - this.lastUpdateTime < this.updateInterval) {
            return; // Skip this update entirely
        }

        // Scan once, including in-place mutations; piece counts are not an invalidation token.
        const topRow = calculateTopRow(gameState);
        this.lastUpdateTime = now;
        this.render(topRow);
    }

    /**
     * Render minimap
     * @private
     */
    render(boardTopRow = null) {
        if (!this.gameState || !this.ctx) return;

        const { width, height } = this.canvas;
        const { ctx } = this;
        const maxRows = this._getMaxRows();
        const rowOffset = this._getRowOffset(maxRows);
        const topRow = rowOffset + (boardTopRow ?? calculateTopRow(this.gameState));
        const totalRows = maxRows;
        const pixelsPerRow = height / totalRows;

        // Clear canvas
        ctx.clearRect(0, 0, width, height);

        const background = this._getBackgroundLayer(width, height);
        ctx.drawImage(background.canvas, 0, 0);

        // Draw animated scanline effect
        this._drawScanlineEffect(ctx, width, height);

        // Progress colors are independent of the live scanline and viewport pulse.
        if (topRow !== this.lastProgressTopRow || maxRows !== this.lastProgressMaxRows) {
            const borderColor = this._getBorderColor(topRow, maxRows);
            const glowColor = this._getBorderGlowColor(topRow, maxRows);
            if (borderColor !== this.lastBorderColor) {
                this.container.style.borderColor = borderColor;
                this.lastBorderColor = borderColor;
            }
            if (glowColor !== this.lastGlowColor) {
                this.container.style.boxShadow = `
            0 14px 40px rgba(10, 16, 30, 0.5),
            inset 0 0 24px ${glowColor}
        `;
                this.lastGlowColor = glowColor;
            }
            this.lastProgressTopRow = topRow;
            this.lastProgressMaxRows = maxRows;
        }

        // Keep CRT above the scanline. Paint labels/build directly in their original order:
        // precomposing those translucent overlapping elements changes pixel rounding.
        const crt = this._getCRTLayer(width, height);
        ctx.drawImage(crt.canvas, 0, 0);
        this._prepareLabelLayout(maxRows);
        this._drawMilestones(ctx, width, height, totalRows, pixelsPerRow);
        this._drawRowLabels(ctx, width, height, totalRows, pixelsPerRow, maxRows);
        this._drawBuild(ctx, width, height, totalRows, pixelsPerRow, topRow);

        // Draw viewport indicator
        this._drawViewport(ctx, width, height, totalRows, pixelsPerRow, rowOffset);

        // Draw top row indicator
        this._drawTopRowIndicator(ctx, width, height, totalRows, pixelsPerRow, topRow);
    }

    _createRasterLayer(width, height) {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        return {
            canvas, ctx: canvas.getContext('2d'), width, height,
        };
    }

    _getBackgroundLayer(width, height) {
        if (!this.backgroundLayer
            || this.backgroundLayer.width !== width || this.backgroundLayer.height !== height) {
            this.backgroundLayer = this._createRasterLayer(width, height);
            const { ctx } = this.backgroundLayer;
            ctx.fillStyle = 'rgba(20, 20, 30, 0.8)';
            ctx.fillRect(0, 0, width, height);
            this._drawBackgroundTexture(ctx, width, height);
        }
        return this.backgroundLayer;
    }

    _getCRTLayer(width, height) {
        if (!this.crtLayer || this.crtLayer.width !== width || this.crtLayer.height !== height) {
            this.crtLayer = this._createRasterLayer(width, height);
            this._drawCRTTexture(this.crtLayer.ctx, width, height);
        }
        return this.crtLayer;
    }

    _prepareLabelLayout(maxRows) {
        if (this.labelLayout?.maxRows === maxRows) return;
        this.milestones = this._buildMilestones(maxRows);
        const normalizedMax = Math.max(1, maxRows);
        const step = Math.max(1, Math.floor(normalizedMax / 4));
        const rawRows = [0, step, step * 2, step * 3, normalizedMax];
        const uniqueRows = [];
        rawRows.forEach((row) => {
            if (!uniqueRows.includes(row)) uniqueRows.push(row);
        });
        this.labelLayout = {
            maxRows,
            labels: uniqueRows.map((row) => {
                let color = '#c4b5fd';
                if (row === 0) color = '#ffffff';
                else if (row === normalizedMax) color = '#fcd17a';
                return { row, text: row.toString(), color };
            }),
        };
    }

    _getMaxRows() {
        const stateMax = Number(this.gameState?.maxRows);
        if (Number.isFinite(stateMax) && stateMax > 0) {
            return Math.min(1000, Math.max(1, stateMax));
        }
        const optionMax = Number(this.options?.maxRows);
        if (Number.isFinite(optionMax) && optionMax > 0) {
            return Math.min(1000, Math.max(1, optionMax));
        }
        return 1000;
    }

    _getRowOffset(maxRows) {
        const boardLength = this.gameState?.board?.length
            || this.gameState?.boardGrid?.length
            || 0;
        return Math.max(0, maxRows - boardLength);
    }

    _buildMilestones(maxRows) {
        const normalizedMax = Math.max(1, maxRows);
        const step = Math.max(1, Math.floor(normalizedMax / 4));
        const raw = [step, step * 2, step * 3, normalizedMax];
        const milestones = [];
        raw.forEach((value) => {
            if (value > 0 && value <= normalizedMax && !milestones.includes(value)) {
                milestones.push(value);
            }
        });
        return milestones;
    }

    /**
     * Draw subtle background texture (dot grid pattern)
     * @private
     * @param {CanvasRenderingContext2D} ctx - Canvas context
     * @param {number} width - Canvas width
     * @param {number} height - Canvas height
     */
    _drawBackgroundTexture(ctx, width, height) {
        ctx.fillStyle = 'rgba(167, 139, 250, 0.08)';
        const dotSpacing = 12;
        const dotSize = 1;

        for (let x = dotSpacing; x < width; x += dotSpacing) {
            for (let y = dotSpacing; y < height; y += dotSpacing) {
                ctx.beginPath();
                ctx.arc(x, y, dotSize, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }

    /**
     * Draw animated scanline effect (futuristic radar sweep)
     * @private
     * @param {CanvasRenderingContext2D} ctx - Canvas context
     * @param {number} width - Canvas width
     * @param {number} height - Canvas height
     */
    _drawScanlineEffect(ctx, width, height) {
        const time = Date.now() / 1000;

        // Moving scanline that sweeps vertically
        const scanlineY = ((time * 60) % height); // Sweeps every ~6.5 seconds at 388px height

        // Create gradient for the moving scanline
        const gradient = ctx.createLinearGradient(0, scanlineY - 40, 0, scanlineY + 40);
        gradient.addColorStop(0, 'rgba(167, 139, 250, 0)');
        gradient.addColorStop(0.4, 'rgba(167, 139, 250, 0.12)');
        gradient.addColorStop(0.5, 'rgba(167, 139, 250, 0.18)');
        gradient.addColorStop(0.6, 'rgba(167, 139, 250, 0.12)');
        gradient.addColorStop(1, 'rgba(167, 139, 250, 0)');

        ctx.fillStyle = gradient;
        ctx.fillRect(0, scanlineY - 40, width, 80);
    }

    _drawCRTTexture(ctx, width, height) {
        // Static scanlines (CRT effect)
        ctx.fillStyle = 'rgba(0, 0, 0, 0.05)';
        for (let y = 0; y < height; y += 4) {
            ctx.fillRect(0, y, width, 2);
        }
    }

    /**
     * Calculate border color based on current progress
     * @private
     * @param {number} topRow - Current top row (0 = goal, maxRows = start)
     * @param {number} maxRows - Max rows for the mode
     * @returns {string} RGB color string
     */
    _getBorderColor(topRow, maxRows = 1000) {
        const normalizedMax = Math.max(1, maxRows);
        // Invert so higher achievement = higher value
        const progress = (normalizedMax - topRow) / normalizedMax; // 0.0 to 1.0

        // Define color stops (Cosmic Serenity ascent ramp (violet -> teal -> gold -> white))
        const colors = [
            { pos: 0.00, color: [167, 139, 250] }, // Violet (base)
            { pos: 0.25, color: [94, 234, 212] }, // Teal
            { pos: 0.50, color: [252, 209, 122] }, // Gold
            { pos: 0.75, color: [255, 226, 168] }, // Light gold
            { pos: 1.00, color: [255, 255, 255] }, // White (Top)
        ];

        // Find surrounding color stops
        let lower = colors[0];
        let upper = colors[colors.length - 1];

        for (let i = 0; i < colors.length - 1; i++) {
            if (progress >= colors[i].pos && progress <= colors[i + 1].pos) {
                lower = colors[i];
                upper = colors[i + 1];
                break;
            }
        }

        // Interpolate between color stops
        const range = upper.pos - lower.pos;
        const rangeProgress = range === 0 ? 0 : (progress - lower.pos) / range;

        const r = Math.round(lower.color[0] + (upper.color[0] - lower.color[0]) * rangeProgress);
        const g = Math.round(lower.color[1] + (upper.color[1] - lower.color[1]) * rangeProgress);
        const b = Math.round(lower.color[2] + (upper.color[2] - lower.color[2]) * rangeProgress);

        return `rgba(${r}, ${g}, ${b}, 0.25)`;
    }

    /**
     * Get brighter version for glow effect
     * @private
     * @param {number} topRow - Current top row (0 = goal, maxRows = start)
     * @param {number} maxRows - Max rows for the mode
     * @returns {string} RGB color string
     */
    _getBorderGlowColor(topRow, maxRows = 1000) {
        const normalizedMax = Math.max(1, maxRows);
        const progress = (normalizedMax - topRow) / normalizedMax;

        const colors = [
            { pos: 0.00, color: [167, 139, 250] }, // Violet (base)
            { pos: 0.25, color: [94, 234, 212] }, // Teal
            { pos: 0.50, color: [252, 209, 122] }, // Gold
            { pos: 0.75, color: [255, 226, 168] }, // Light gold
            { pos: 1.00, color: [255, 255, 255] }, // White (Top)
        ];

        let lower = colors[0];
        let upper = colors[colors.length - 1];

        for (let i = 0; i < colors.length - 1; i++) {
            if (progress >= colors[i].pos && progress <= colors[i + 1].pos) {
                lower = colors[i];
                upper = colors[i + 1];
                break;
            }
        }

        const range = upper.pos - lower.pos;
        const rangeProgress = range === 0 ? 0 : (progress - lower.pos) / range;

        const r = Math.round(lower.color[0] + (upper.color[0] - lower.color[0]) * rangeProgress);
        const g = Math.round(lower.color[1] + (upper.color[1] - lower.color[1]) * rangeProgress);
        const b = Math.round(lower.color[2] + (upper.color[2] - lower.color[2]) * rangeProgress);

        return `rgba(${r}, ${g}, ${b}, 0.15)`;
    }

    /**
     * Draw height milestone markers
     * CORRECTED: Row 0 at TOP, Row maxRows at BOTTOM
     * @private
     */
    _drawMilestones(ctx, width, height, totalRows, pixelsPerRow) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.lineWidth = 1;
        ctx.font = '8px monospace';
        ctx.textAlign = 'right';

        this.milestones.forEach((milestone) => {
            if (milestone <= totalRows) {
                // Row 0 at top (y=0), Row maxRows at bottom (y=height)
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
     * CORRECTED: Row 0 at TOP, Row maxRows at BOTTOM
     * @private
     */
    _drawRowLabels(ctx, width, height, totalRows, pixelsPerRow, maxRows) {
        this._prepareLabelLayout(maxRows);

        ctx.font = 'bold 10px monospace';
        ctx.textAlign = 'right';

        this.labelLayout.labels.forEach(({ row, text, color }) => {
            if (row <= totalRows) {
                // Row 0 at top (y=0), Row maxRows at bottom (y=height)
                const y = row * pixelsPerRow;

                // Opaque chip behind the label so it stays readable over the panel
                ctx.fillStyle = 'rgba(10, 8, 22, 0.92)';
                ctx.fillRect(width - 32, y - 7, 30, 14);

                // Text (with a soft shadow for extra contrast)
                ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
                ctx.shadowBlur = 2;
                ctx.fillStyle = color;
                ctx.fillText(text, width - 3, y + 3);
                ctx.shadowBlur = 0;
                ctx.shadowColor = 'transparent';
            }
        });
    }

    /**
     * Draw build (all placed blocks)
     * @private
     */
    _drawBuild(ctx, width, height, totalRows, pixelsPerRow, topRow) {
        // Sample blocks for minimap (can't draw every single block at this scale)
        // Draw a simplified representation using actual row positions
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

        // Cache preparation only; painting directly preserves original alpha composition.
        if (!this.buildFill || this.buildFill.ctx !== ctx
            || this.buildFill.topY !== topY || this.buildFill.bottomY !== bottomY) {
            const gradient = ctx.createLinearGradient(0, topY, 0, bottomY);
            gradient.addColorStop(0, 'rgba(167, 139, 250, 0.7)');
            gradient.addColorStop(1, 'rgba(110, 80, 190, 0.85)');
            this.buildFill = {
                ctx, topY, bottomY, gradient,
            };
        }

        ctx.fillStyle = this.buildFill.gradient;
        ctx.fillRect(2, topY, width - 4, fillHeight);

        // Add outline
        ctx.strokeStyle = 'rgba(196, 181, 253, 0.85)';
        ctx.lineWidth = 1;
        ctx.strokeRect(2, topY, width - 4, fillHeight);
    }

    /**
     * Draw viewport indicator (current camera view)
     * CORRECTED: Row 0 at TOP, Row maxRows at BOTTOM
     * cameraRow represents the TOP of the viewport
     * @private
     */
    _drawViewport(ctx, width, height, totalRows, pixelsPerRow, rowOffset) {
        // Calculate viewport position
        // cameraRow is the TOP row of the viewport
        const viewportTopRow = rowOffset + this.cameraRow;
        const viewportBottomRow = rowOffset + this.cameraRow + this.visibleRows;

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
        ctx.fillStyle = 'rgba(167, 139, 250, 0.15)'; // Subtle cyan tint
        ctx.fillRect(0, viewportY, width, viewportHeight);

        // Draw viewport border with pulsing glow effect
        const time = Date.now() / 1000;
        const pulse = Math.sin(time * Math.PI) * 0.3 + 0.7; // Oscillates 0.7-1.0

        ctx.strokeStyle = `rgba(167, 139, 250, ${0.8 * pulse})`;
        ctx.lineWidth = 2;
        ctx.shadowBlur = 8 + (pulse * 8); // 8-16px blur
        ctx.shadowColor = `rgba(167, 139, 250, ${pulse * 0.8})`;
        ctx.strokeRect(0, viewportY, width, viewportHeight);

        // Reset shadow for other drawing operations
        ctx.shadowBlur = 0;
        ctx.shadowColor = 'transparent';

        // Draw scroll arrow indicator
        this._drawScrollArrow(ctx, width, viewportY + viewportHeight / 2);
    }

    /**
     * Draw top row indicator (highest block)
     * CORRECTED: Row 0 at TOP, Row maxRows at BOTTOM
     * @private
     */
    _drawTopRowIndicator(ctx, width, height, totalRows, pixelsPerRow, topRow) {
        // Row 0 at top (y=0), so topRow maps directly to Y
        const topRowY = topRow * pixelsPerRow;

        // Draw indicator line
        ctx.strokeStyle = 'rgba(255, 158, 205, 0.85)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, topRowY);
        ctx.lineTo(width, topRowY);
        ctx.stroke();

        // Draw arrow indicator
        ctx.fillStyle = 'rgba(255, 158, 205, 0.85)';
        ctx.beginPath();
        ctx.moveTo(width - 2, topRowY); // Point
        ctx.lineTo(width - 7, topRowY - 3); // Top
        ctx.lineTo(width - 7, topRowY + 3); // Bottom
        ctx.closePath();
        ctx.fill();
    }

    /**
     * Handle click to jump to position (only used during exploration)
     * @private
     */
    _onClick(event) {
        // Click events are now handled through mousedown/move/up for exploration
        // This is kept for potential future use but not actively used
    }

    /**
 * Handle mouse down - immediately start exploration mode
 * @private
 */
    _onMouseDown(event) {
        event.preventDefault();

        // Start exploration mode immediately (pause the game)
        this.isDragging = true;
        this.isExploring = true;
        this.dragStartY = event.clientY;

        console.log('[InfinityMinimap] Exploration started - mousedown');

        // Dispatch exploration-start event (InfinityMode will pause the game)
        this.container.dispatchEvent(new CustomEvent('minimap-exploration-start', {
            bubbles: true,
        }));

        // Dispatch initial jump to clicked position
        this._dispatchJump(event);

        // Attach global listeners to handle dragging outside the minimap
        window.addEventListener('mouseup', this.handleWindowMouseUp);
        window.addEventListener('mousemove', this.handleWindowMouseMove);
    }

    /**
     * Handle mouse move - update camera during exploration
     * @private
     */
    /**
     * Handle global mouse move during exploration
     * @private
     */
    _onWindowMouseMove(event) {
        if (!this.isDragging) return;

        // Already exploring - dispatch continuous camera updates
        if (this.isExploring) {
            this._dispatchJump(event);
        }
    }

    /**
     * Handle global mouse up - end exploration
     * @private
     */
    _onWindowMouseUp(event) {
        if (this.isExploring) {
            console.log('[InfinityMinimap] Exploration ended - global mouse released');

            // Dispatch exploration-end event (InfinityMode will resume the game)
            this.container.dispatchEvent(new CustomEvent('minimap-exploration-end', {
                bubbles: true,
            }));
        }

        // Reset all drag state
        this.isDragging = false;
        this.isExploring = false;
        this.dragStartY = null;

        // Remove global listeners
        window.removeEventListener('mouseup', this.handleWindowMouseUp);
        window.removeEventListener('mousemove', this.handleWindowMouseMove);
    }

    /**
     * Handle mouse move (local) - kept for safety/fallback but mainly handled by window listener
     * @private
     */
    _onMouseMove(event) {
        // No-op, handled by window listener when dragging
    }

    /**
     * Handle mouse up (local) - no-op, handled by global listener
     * @private
     */
    _onMouseUp(event) {
        // No-op
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
     * Handle mouse leave - end exploration if active
     * @private
     */
    _onMouseLeave() {
        this.isHovering = false;
        this.canvas.style.opacity = '0.8';

        // NOTE: We do NOT end exploration on mouse leave anymore.
        // Exploration continues until mouse is released (handled by global listener).
    }

    /**
     * Dispatch a minimap-jump event for the current mouse position
     * @private
     */
    _dispatchJump(event) {
        const rect = this.canvas.getBoundingClientRect();
        const y = event.clientY - rect.top;
        const targetRow = this._getRowFromY(y);

        this.container.dispatchEvent(new CustomEvent('minimap-jump', {
            detail: { targetRow },
            bubbles: true,
        }));
    }

    /**
     * Handle container mouse move for cursor tracking glow
     * @private
     */
    _onContainerMouseMove(event) {
        if (!this.isHovering) return;

        const rect = this.container.getBoundingClientRect();
        this.mouseX = ((event.clientX - rect.left) / rect.width) * 100;
        this.mouseY = ((event.clientY - rect.top) / rect.height) * 100;

        // Update background with radial gradient at cursor position
        this.container.style.background = `
            radial-gradient(circle 120px at ${this.mouseX}% ${this.mouseY}%,
                rgba(167, 139, 250, 0.18) 0%,
                rgba(140, 110, 220, 0.10) 40%,
                transparent 100%),
            linear-gradient(180deg, rgba(6, 10, 24, 0.92), rgba(4, 6, 18, 0.92))
        `;
    }

    /**
     * Handle container mouse leave for cursor tracking glow
     * @private
     */
    _onContainerMouseLeave() {
        // Reset to default gradient
        this.container.style.background = 'linear-gradient(180deg, rgba(6, 10, 24, 0.92), rgba(4, 6, 18, 0.92))';
    }

    /**
     * Helper: Draw arrow showing current viewport
     * @private
     */
    _drawScrollArrow(ctx, width, centerY) {
        const arrowSize = 5;

        ctx.fillStyle = '#c4b5fd';
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
        clearTimeout(this.hideTimeout);
        this.hideTimeout = null;
        this.backgroundLayer = null;
        this.crtLayer = null;
        this.labelLayout = null;
        this.buildFill = null;
        // Remove event listeners
        this.canvas.removeEventListener('click', this.handleClick);
        this.canvas.removeEventListener('mousedown', this.handleMouseDown);
        this.canvas.removeEventListener('mousemove', this.handleMouseMove);
        this.canvas.removeEventListener('mouseup', this.handleMouseUp);
        this.canvas.removeEventListener('mouseenter', this.handleMouseEnter);
        this.canvas.removeEventListener('mouseleave', this.handleMouseLeave);
        this.container.removeEventListener('mousemove', this.handleContainerMouseMove);
        this.container.removeEventListener('mouseleave', this.handleContainerMouseLeave);

        // Remove global listeners just in case
        window.removeEventListener('mouseup', this.handleWindowMouseUp);
        window.removeEventListener('mousemove', this.handleWindowMouseMove);

        // Remove from DOM
        if (this.container.parentElement) {
            this.container.parentElement.removeChild(this.container);
        }

        console.log('[InfinityMinimap] Destroyed');
    }
}
