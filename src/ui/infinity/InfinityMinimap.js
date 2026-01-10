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

        // Exploration mode state (drag-to-explore)
        this.isExploring = false;       // True when actively exploring (drag threshold met)
        this.dragStartY = null;         // Y position where drag started
        this.dragThreshold = 8;         // Minimum pixels before entering exploration mode

        // Mouse position for cursor glow effect
        this.mouseX = 50; // Center by default (percentage)
        this.mouseY = 50;

        // Height milestones
        this.milestones = [100, 250, 500, 750, 1000];

        // PERFORMANCE: Dirty flag system to prevent unnecessary redraws
        // Only render when something actually changed
        this.lastCameraRow = null;
        this.lastBuildHeight = null;
        this.lastTopRow = null;
        this.lastLockedPiecesCount = 0;

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
            padding: 12px 12px 16px 12px;
            box-shadow:
                0 14px 40px rgba(10, 16, 30, 0.5),
                inset 0 0 24px rgba(60, 255, 200, 0.2);
            cursor: pointer;
            margin-top: 0;
            display: none;
            box-sizing: border-box;
            opacity: 0.8;
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
            border-radius: 10px;
            background: rgba(10, 18, 40, 0.85);
            transition: opacity 0.3s ease;
        `;

        this.ctx = this.canvas.getContext('2d');

        // Add animations and hover styles
        const hoverStyle = document.createElement('style');
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
                    opacity: 0.8;
                }
            }

            /* Slide-out animation */
            @keyframes minimapSlideOut {
                0% {
                    transform: translateX(0) scale(1);
                    opacity: 0.8;
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
                        0 14px 40px rgba(10, 16, 30, 0.5),
                        inset 0 0 24px rgba(60, 255, 200, 0.2),
                        0 0 0 0 rgba(100, 255, 200, 0.7);
                }
                50% {
                    box-shadow:
                        0 14px 40px rgba(10, 16, 30, 0.5),
                        inset 0 0 40px rgba(60, 255, 200, 0.6),
                        0 0 30px 15px rgba(100, 255, 200, 0);
                }
                100% {
                    box-shadow:
                        0 14px 40px rgba(10, 16, 30, 0.5),
                        inset 0 0 24px rgba(60, 255, 200, 0.2),
                        0 0 0 0 rgba(100, 255, 200, 0);
                }
            }

            /* Enhanced border pulse for active state */
            @keyframes borderPulseActive {
                0%, 100% {
                    border-color: rgba(100, 255, 200, 0.5);
                }
                50% {
                    border-color: rgba(100, 255, 200, 0.8);
                }
            }

            .infinity-minimap:hover {
                opacity: 1 !important;
                transform: scale(1.02) !important;
                border-color: rgba(100, 255, 200, 0.65) !important;
                box-shadow:
                    0 18px 50px rgba(10, 16, 30, 0.7),
                    inset 0 0 32px rgba(60, 255, 200, 0.35),
                    0 0 40px rgba(100, 255, 200, 0.2) !important;
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
                color: rgba(100, 255, 200, 0.9) !important;
                text-shadow: 0 0 10px rgba(100, 255, 200, 0.5);
            }
        `;
        document.head.appendChild(hoverStyle);

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
            color: rgba(100, 255, 200, 0.5);
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
        this.container.addEventListener('mousemove', this._onContainerMouseMove.bind(this));
        this.container.addEventListener('mouseleave', this._onContainerMouseLeave.bind(this));

        console.log('[InfinityMinimap] Initialized');
    }

    /**
     * Show minimap (always visible, no entrance animation)
     */
    show() {
        const panel = document.getElementById('single-player-container');

        if (panel && this.container.parentElement !== panel) {
            panel.appendChild(this.container);
        }

        // Simply show without animation
        this.container.style.display = 'block';
        this.container.style.transform = 'translateX(0) scale(1)';
        this.container.style.opacity = '0.8';

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
        setTimeout(() => {
            this.container.style.display = 'none';
            this.container.style.animation = 'none';
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
        // Note: Always render to support pulsing animation, but throttled by updateInterval
        const shouldRender = this.lastCameraRow !== cameraRow
            || this.lastBuildHeight !== buildHeight
            || this.lastTopRow !== topRow
            || this.lastLockedPiecesCount !== lockedPiecesCount
            || this.gameState === null // First render
            || true; // Always render for smooth animations (throttled by updateInterval)

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
        const { ctx } = this;

        // Clear canvas
        ctx.clearRect(0, 0, width, height);

        // Draw background
        ctx.fillStyle = 'rgba(20, 20, 30, 0.8)';
        ctx.fillRect(0, 0, width, height);

        // Draw subtle background texture
        this._drawBackgroundTexture(ctx, width, height);

        // Draw animated scanline effect
        this._drawScanlineEffect(ctx, width, height);

        const totalRows = this.gameState.board.length;
        const pixelsPerRow = height / totalRows;

        // Update border color based on progress
        const topRow = calculateTopRow(this.gameState);
        const borderColor = this._getBorderColor(topRow);
        const glowColor = this._getBorderGlowColor(topRow);

        this.container.style.borderColor = borderColor;
        this.container.style.boxShadow = `
            0 14px 40px rgba(10, 16, 30, 0.5),
            inset 0 0 24px ${glowColor}
        `;

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
     * Draw subtle background texture (dot grid pattern)
     * @private
     * @param {CanvasRenderingContext2D} ctx - Canvas context
     * @param {number} width - Canvas width
     * @param {number} height - Canvas height
     */
    _drawBackgroundTexture(ctx, width, height) {
        ctx.fillStyle = 'rgba(100, 255, 200, 0.08)';
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
        gradient.addColorStop(0, 'rgba(100, 255, 200, 0)');
        gradient.addColorStop(0.4, 'rgba(100, 255, 200, 0.12)');
        gradient.addColorStop(0.5, 'rgba(100, 255, 200, 0.18)');
        gradient.addColorStop(0.6, 'rgba(100, 255, 200, 0.12)');
        gradient.addColorStop(1, 'rgba(100, 255, 200, 0)');

        ctx.fillStyle = gradient;
        ctx.fillRect(0, scanlineY - 40, width, 80);

        // Static scanlines (CRT effect)
        ctx.fillStyle = 'rgba(0, 0, 0, 0.05)';
        for (let y = 0; y < height; y += 4) {
            ctx.fillRect(0, y, width, 2);
        }
    }

    /**
     * Calculate border color based on current progress
     * @private
     * @param {number} topRow - Current top row (0 = goal, 1000 = start)
     * @returns {string} RGB color string
     */
    _getBorderColor(topRow) {
        // Invert so higher achievement = higher value
        const progress = (1000 - topRow) / 1000; // 0.0 to 1.0

        // Define color stops
        const colors = [
            { pos: 0.00, color: [100, 255, 200] }, // Cyan-green (start)
            { pos: 0.25, color: [50, 255, 150] }, // Green
            { pos: 0.50, color: [200, 255, 100] }, // Yellow-green
            { pos: 0.75, color: [255, 200, 50] }, // Orange-yellow
            { pos: 1.00, color: [255, 150, 50] }, // Orange (near goal)
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

        return `rgba(${r}, ${g}, ${b}, 0.5)`;
    }

    /**
     * Get brighter version for glow effect
     * @private
     * @param {number} topRow - Current top row (0 = goal, 1000 = start)
     * @returns {string} RGB color string
     */
    _getBorderGlowColor(topRow) {
        const progress = (1000 - topRow) / 1000;

        const colors = [
            { pos: 0.00, color: [100, 255, 200] },
            { pos: 0.25, color: [50, 255, 150] },
            { pos: 0.50, color: [200, 255, 100] },
            { pos: 0.75, color: [255, 200, 50] },
            { pos: 1.00, color: [255, 150, 50] },
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

        return `rgba(${r}, ${g}, ${b}, 0.25)`;
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

        this.milestones.forEach((milestone) => {
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
            { row: 0, text: '0', color: '#ff0000' }, // Top (goal)
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
        const { board } = this.gameState;

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

        // Draw viewport border with pulsing glow effect
        const time = Date.now() / 1000;
        const pulse = Math.sin(time * Math.PI) * 0.3 + 0.7; // Oscillates 0.7-1.0

        ctx.strokeStyle = `rgba(0, 255, 0, ${pulse})`;
        ctx.lineWidth = 2;
        ctx.shadowBlur = 8 + (pulse * 8); // 8-16px blur
        ctx.shadowColor = `rgba(0, 255, 0, ${pulse * 0.8})`;
        ctx.strokeRect(0, viewportY, width, viewportHeight);

        // Reset shadow for other drawing operations
        ctx.shadowBlur = 0;
        ctx.shadowColor = 'transparent';

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
    }

    /**
     * Handle mouse move - update camera during exploration
     * @private
     */
    _onMouseMove(event) {
        if (!this.isDragging) return;

        // Already exploring - dispatch continuous camera updates
        if (this.isExploring) {
            this._dispatchJump(event);
        }
    }

    /**
     * Handle mouse up - end exploration if active
     * @private
     */
    _onMouseUp(event) {
        if (this.isExploring) {
            console.log('[InfinityMinimap] Exploration ended - mouse released');

            // Dispatch exploration-end event (InfinityMode will resume the game)
            this.container.dispatchEvent(new CustomEvent('minimap-exploration-end', {
                bubbles: true,
            }));
        }

        // Reset all drag state
        this.isDragging = false;
        this.isExploring = false;
        this.dragStartY = null;
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

        // If we were exploring, end exploration on mouseleave
        if (this.isExploring && this.isDragging) {
            console.log('[InfinityMinimap] Exploration ended - mouse left minimap');

            // Dispatch exploration-end event
            this.container.dispatchEvent(new CustomEvent('minimap-exploration-end', {
                bubbles: true,
            }));
        }

        // Reset all drag state
        this.isDragging = false;
        this.isExploring = false;
        this.dragStartY = null;
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
                rgba(100, 255, 200, 0.18) 0%,
                rgba(60, 255, 200, 0.08) 40%,
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
