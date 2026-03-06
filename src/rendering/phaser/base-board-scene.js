import {
    COLS, ROWS, HIDDEN_ROWS, BLOCK_SIZE, COLORS,
} from '../../core/constants.js';
import { ensureCircleTexture } from './utils/index.js';
import { getQualityConfig, normalizeQuality } from '../../utils/quality.js';
import { performanceMonitor } from '../../utils/performance-monitor.js';
import { getGhostLandingY } from '../../core/game.js';
import { TetrominoStyleManager } from '../tetromino-style-manager.js';

const DEFAULT_PARTICLE_KEY = 'common-circle-4px';
const DEFAULT_SHAKE_INTENSITY = 0.002;

let cachedBaseClass = null;
let cachedPhaserRef = null;

/**
 * Create the BaseBoardScene class for Phaser 4.
 * Factory function that generates a Scene class once Phaser is available.
 *
 * @param {typeof Phaser} phaserLib - Phaser 4 library reference
 * @returns {typeof Phaser.Scene} - BaseBoardScene class
 */
export function createBaseBoardScene(
    phaserLib = typeof window !== 'undefined' ? window.Phaser : null,
) {
    const PhaserRef = phaserLib;

    // Validate Phaser 4 availability
    if (!PhaserRef?.Scene) {
        throw new Error(
            '[BaseBoardScene] Phaser 4 is not available. Ensure Phaser is imported before creating scenes.',
        );
    }

    // Return cached class if already created (performance optimization)
    if (cachedBaseClass && cachedPhaserRef === PhaserRef) {
        console.log('[BaseBoardScene] Returning cached class');
        return cachedBaseClass;
    }

    console.log('[BaseBoardScene] Creating new Phaser 4 scene class');

    class BaseBoardScene extends PhaserRef.Scene {
        /**
         * @param {string} key - Phaser scene key
         * @param {Object} [boardConfig] - Dimensions for the board scene
         * @param {number} [boardConfig.cols]
         * @param {number} [boardConfig.rows]
         * @param {number} [boardConfig.hiddenRows]
         * @param {number} [boardConfig.blockSize]
         */
        constructor(key, boardConfig = {}) {
            const resolvedKey = key
                ?? `BaseBoardScene-${PhaserRef.Utils?.String?.UUID ? PhaserRef.Utils.String.UUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`}`;
            super(resolvedKey);

            this.boardConfig = {
                cols: boardConfig.cols ?? COLS,
                rows: boardConfig.rows ?? ROWS,
                hiddenRows: boardConfig.hiddenRows ?? HIDDEN_ROWS,
                blockSize: boardConfig.blockSize ?? BLOCK_SIZE,
            };

            this.sceneKey = resolvedKey;

            // Maintain backwards compatibility with existing scenes
            this.cols = this.boardConfig.cols;
            this.rows = this.boardConfig.rows;
            this.hiddenRows = this.boardConfig.hiddenRows;
            this.blockSize = this.boardConfig.blockSize;

            this.graphicsLayers = {
                board: null,    // Static layer: locked pieces (only redraws when board changes)
                piece: null,    // Dynamic layer: current piece, ghost, animations (redraws every frame)
                fx: null,       // Effects layer: particles, line clears, etc.
            };

            this.commonParticleKey = DEFAULT_PARTICLE_KEY;
            this.lastShakeTimestamp = 0;
            this.gameState = null;
            this.effectQuality = 'High';
            this.qualityConfig = getQualityConfig(this.effectQuality);
            this.cameraSettings = null;
            this._comboPaletteCache = null;

            // PERFORMANCE: Periodic cleanup counters to prevent memory leaks
            this.frameCount = 0;
            this.cleanupInterval = 60; // Clean up every 1 second at 60fps (increased frequency)

            // PERFORMANCE: Dual-layer caching - only redraw static content when board changes
            this._boardDirty = true; // Start dirty to trigger initial render
            this._lastBoardGridRef = null; // Track board grid reference for change detection
            this._lastBoardVersion = -1; // Track board version for more reliable change detection
            this._lastVisibleRowRange = null; // Track visible row band so camera scrolling redraws static layer
            this._firstRenderEmitted = false;

            // Initialize Tetromino Style Manager for theme-based tetromino colors
            this.styleManager = new TetrominoStyleManager(
                typeof window !== 'undefined' ? window.themeManager : null,
                typeof window !== 'undefined' ? window.settingsManager : null,
            );
            if (this.styleManager) {
                this.styleManager.init();
            }

            // No caching needed - simple is better
        }

        /**
         * Phaser 4 lifecycle: preload assets
         * Called before create(), used for loading assets
         */
        preload() {
            try {
                ensureCircleTexture(this, this.commonParticleKey, 4);
            } catch (error) {
                console.error('[BaseBoardScene] Failed to create particle texture:', error);
            }
        }

        /**
         * Phaser 4 lifecycle: create scene objects
         * Called after preload(), used for initializing game objects
         */
        create() {
            try {
                this.createGraphicsLayers();
                this.configureCamera();
                this.registerResizeHandler();
                this._firstRenderEmitted = false;
                console.log(`[BaseBoardScene] Scene created: ${this.sceneKey}`);
            } catch (error) {
                console.error('[BaseBoardScene] Failed to create scene:', error);
            }
        }

        /**
         * Phaser 4 lifecycle: update loop
         * Called every frame (60 times per second)
         * @param {number} time - Total elapsed time since game start (ms)
         * @param {number} delta - Time elapsed since last frame (ms)
         */
        update(time, delta) {
            // eslint-disable-line no-unused-vars
            // Performance monitoring - mark frame start
            performanceMonitor.updateStart();

            if (!this.gameState) return;

            // PERFORMANCE: Periodic cleanup to prevent memory leaks
            // This fixes the time-based FPS degradation issue
            this.frameCount++;
            if (this.frameCount >= this.cleanupInterval) {
                this.frameCount = 0;
                this._performPeriodicCleanup();
            }

            // PERFORMANCE: Dual-layer caching optimization
            // Only redraw static content (locked pieces) when board actually changes
            try {
                // Check if board content has changed (piece locked, lines cleared, etc.)
                this._checkBoardDirty();
                this._checkVisibleRowRangeDirty();

                // Static layer (boardGraphics): only clear and redraw when board changes
                if (this._boardDirty) {
                    this.boardGraphics?.clear();
                }

                // Dynamic layer (pieceGraphics): always clear for current piece/ghost updates
                this.pieceGraphics?.clear();
                this.effectsGraphics?.clear();

                performanceMonitor.updateEnd();
                performanceMonitor.renderStart();

                // Render game state with dual-layer optimization
                this.renderGameState();

                if (!this._firstRenderEmitted) {
                    this._emitFirstRender();
                }

                // Mark board as clean after rendering
                if (this._boardDirty) {
                    this._boardDirty = false;
                }

                performanceMonitor.renderEnd();
            } catch (error) {
                console.error('[BaseBoardScene] Error in update loop:', error);
            }
        }

        /**
         * Check if the board content has changed and needs redrawing.
         * Uses reference comparison and version tracking for efficiency.
         */
        _checkBoardDirty() {
            const currentGrid = this.gameState?.boardGrid;
            const currentVersion = this.gameState?.boardVersion ?? 0;

            // Check if grid reference changed or version bumped
            if (currentGrid !== this._lastBoardGridRef || currentVersion !== this._lastBoardVersion) {
                this._boardDirty = true;
                this._lastBoardGridRef = currentGrid;
                this._lastBoardVersion = currentVersion;
            }
        }

        /**
         * Mark static layer dirty when the visible row band changes.
         * Without this, camera scrolling in Infinity mode can show blank rows
         * because the cached static layer still contains the old viewport slice.
         */
        _checkVisibleRowRangeDirty() {
            if (!this.gameState?.boardGrid) return;

            const { startRow, endRow } = this.getVisibleRowRange();
            const prevRange = this._lastVisibleRowRange;

            if (!prevRange || prevRange.startRow !== startRow || prevRange.endRow !== endRow) {
                this._boardDirty = true;
                this._lastVisibleRowRange = { startRow, endRow };
            }
        }

        /**
         * Mark the board as dirty, forcing a redraw on the next frame.
         * Call this when external events modify the board (e.g., garbage received).
         */
        markBoardDirty() {
            this._boardDirty = true;
        }

        /**
         * Calculate which board rows should be drawn this frame.
         * Limits rendering work to the active viewport plus a small padding band.
         */
        getVisibleRowRange() {
            const grid = this.gameState?.boardGrid;
            const totalRows = grid ? grid.length : this.rows + this.hiddenRows;
            const isInfinityMode = Boolean(this.gameState?.isInfinityMode);
            const defaultStart = isInfinityMode ? 0 : this.hiddenRows;
            const clampedDefaultStart = Math.min(Math.max(defaultStart, 0), totalRows);

            if (!this.cameraSettings) {
                return {
                    startRow: clampedDefaultStart,
                    endRow: totalRows,
                };
            }

            const topRow = Math.max(
                0,
                Math.floor(this.cameraSettings.activeTopRow
                    ?? this.cameraSettings.currentTopRow
                    ?? clampedDefaultStart),
            );
            const visibleRows = Math.max(1, Math.ceil(this.cameraSettings.visibleRows || this.rows));
            const padding = Math.max(0, this.cameraSettings.renderPadding ?? 0);
            const startRow = Math.max(clampedDefaultStart, topRow - padding);
            let endRow = Math.min(totalRows, topRow + visibleRows + padding);

            if (endRow <= startRow) {
                endRow = Math.min(totalRows, startRow + visibleRows);
            }

            return { startRow, endRow };
        }

        setEffectQuality(level) {
            this.effectQuality = normalizeQuality(level);
            this.qualityConfig = getQualityConfig(this.effectQuality);
        }

        getEffectQuality() {
            return this.effectQuality;
        }

        getQualityConfig() {
            return this.qualityConfig;
        }

        /**
         * Check if we should create particles based on quality settings and current count
         * Optimization: Skip particle creation if budget exceeded or disabled
         * @returns {boolean} True if particles should be created
         */
        shouldCreateParticles() {
            // Check if particles are enabled for this quality level
            if (!this.qualityConfig?.particles) {
                return false;
            }

            // Check active particle count against budget
            if (this.activeParticleSystems) {
                const budget = this.qualityConfig.particleBudget;
                if (budget && this.activeParticleSystems.size >= budget.maxTotal) {
                    return false; // Budget exceeded
                }
            }

            return true;
        }

        /**
         * Get remaining particle budget for a specific effect type
         * @param {string} effectType - Type of effect (lineClear, combo, trail, background)
         * @returns {number} Number of particles available for this effect
         */
        getParticleBudgetRemaining(effectType) {
            const budget = this.qualityConfig?.particleBudget;
            if (!budget || !this.activeParticleSystems) {
                return 0;
            }

            // Return budget for specific effect type
            return budget[effectType] || 0;
        }

        /**
         * Create default graphics layers for rendering.
         * Phaser 4: Validates graphics API availability
         */
        createGraphicsLayers() {
            if (!this.add || !this.add.graphics) {
                console.error('[BaseBoardScene] Graphics API not available');
                return;
            }

            try {
                this.graphicsLayers.board = this.add.graphics();
                this.graphicsLayers.piece = this.add.graphics();
                this.graphicsLayers.fx = this.add.graphics();
                console.log('[BaseBoardScene] Graphics layers created successfully');
            } catch (error) {
                console.error('[BaseBoardScene] Failed to create graphics layers:', error);
                throw error;
            }
        }

        /**
         * Convenience helper to expose legacy properties.
         */
        attachGraphicsLayerAliases() {
            this.boardGraphics = this.graphicsLayers.board;
            this.pieceGraphics = this.graphicsLayers.piece;
            this.effectsGraphics = this.graphicsLayers.fx;
        }

        /**
         * Calculates the board's logical width/height in pixels.
         * @returns {{width:number, height:number}}
         */
        getBoardDimensions() {
            const {
                cols, rows, hiddenRows, blockSize,
            } = this.boardConfig;
            return {
                width: cols * blockSize,
                // Return the full height of the board, including the hidden area for spawning
                height: (rows + hiddenRows) * blockSize,
            };
        }

        /**
         * Get themed color for a piece type
         * @param {string} pieceType - Piece type ('I', 'O', 'T', 'S', 'Z', 'J', 'L', 'GARBAGE')
         * @param {string} fallbackColor - Fallback color if themed colors are disabled
         * @returns {string} Hex color string
         */
        getThemedColor(pieceType, fallbackColor) {
            if (!this.styleManager || !pieceType) {
                return fallbackColor || '#808080';
            }

            const styleConfig = this.styleManager.getStyleForPiece(pieceType);
            return styleConfig.color || fallbackColor || '#808080';
        }

        /**
         * Get theme-driven combo tint (used by particle effects)
         * @param {number} comboCount
         * @param {number} index
         * @returns {number} Hex tint
         */
        getComboTint(comboCount = 1, index = 0) {
            const palette = this._getComboPalette();
            if (!palette || palette.length === 0) {
                return 0x00ffff;
            }

            if (comboCount <= 1) {
                return palette[0];
            }

            if (comboCount <= 4) {
                return palette[Math.min(comboCount, palette.length - 1)];
            }

            return palette[index % palette.length];
        }

        /**
         * Build or reuse palette generated from theme tetromino colors
         * @private
         */
        _getComboPalette() {
            const baseColor = this._getThemeComboBaseColor();

            if (
                this._comboPaletteCache
                && this._comboPaletteCache.base === baseColor
                && Array.isArray(this._comboPaletteCache.colors)
            ) {
                return this._comboPaletteCache.colors;
            }

            const rgb = this._parseColor(baseColor);
            if (!rgb) {
                const fallback = this._parseColor('#00ffff') || { int: 0x00ffff };
                this._comboPaletteCache = { base: baseColor, colors: [fallback.int] };
                return this._comboPaletteCache.colors;
            }

            const adjustments = [0, 0.18, -0.15, 0.35, -0.3, 0.55, -0.08];
            const colors = adjustments.map((amount) => this._adjustColor(rgb, amount));
            this._comboPaletteCache = { base: baseColor, colors };
            return colors;
        }

        /**
         * Resolve the best base color to derive effects from
         * @private
         */
        _getThemeComboBaseColor() {
            if (this.gameState?.comboState?.sourceColor) {
                return this.gameState.comboState.sourceColor;
            }

            if (this.styleManager && this.gameState?.currentPiece?.type) {
                const style = this.styleManager.getStyleForPiece(this.gameState.currentPiece.type);
                if (style?.color) {
                    return style.color;
                }
            }

            if (this.styleManager?.getAllColors) {
                const colorMap = this.styleManager.getAllColors();
                if (colorMap) {
                    return (
                        colorMap.I
                        || colorMap.T
                        || colorMap.L
                        || colorMap.O
                        || Object.values(colorMap)[0]
                    );
                }
            }

            return COLORS.I || '#00ffff';
        }

        /**
         * Normalize color value into RGB/int representation
         * @private
         */
        _parseColor(colorValue) {
            if (typeof colorValue === 'number' && Number.isFinite(colorValue)) {
                const intValue = colorValue >>> 0;
                return {
                    r: (intValue >> 16) & 0xff,
                    g: (intValue >> 8) & 0xff,
                    b: intValue & 0xff,
                    int: intValue,
                };
            }

            if (typeof colorValue !== 'string') {
                return null;
            }

            let hex = colorValue.trim();
            if (hex.startsWith('#')) {
                hex = hex.slice(1);
            }
            if (hex.length === 3) {
                hex = hex
                    .split('')
                    .map((char) => char + char)
                    .join('');
            }
            if (hex.length !== 6) {
                return null;
            }

            const value = parseInt(hex, 16);
            if (Number.isNaN(value)) {
                return null;
            }

            return {
                r: (value >> 16) & 0xff,
                g: (value >> 8) & 0xff,
                b: value & 0xff,
                int: value,
            };
        }

        /**
         * Lighten or darken a base color by mixing with white/black
         * @private
         */
        _adjustColor(rgb, amount = 0) {
            if (!rgb) {
                return 0x00ffff;
            }

            const clamp = (value) => Math.max(0, Math.min(255, value));
            const adjust = (channel) => {
                if (amount >= 0) {
                    return clamp(Math.round(channel + (255 - channel) * amount));
                }
                return clamp(Math.round(channel + channel * amount));
            };

            const r = adjust(rgb.r);
            const g = adjust(rgb.g);
            const b = adjust(rgb.b);

            return (r << 16) | (g << 8) | b;
        }

        /**
         * Configure primary camera defaults.
         */
        configureCamera() {
            const camera = this.cameras?.main;
            if (!camera) return;

            camera.setRoundPixels(false);
            const { width, height } = this.getBoardDimensions();
            const { hiddenRows, blockSize } = this.boardConfig;

            const isInfinityMode = this.gameState?.isInfinityMode;

            if (isInfinityMode) {
                const totalRows = this.gameState.board?.length
                    ?? (this.rows + this.hiddenRows);
                const visibleRows = this.boardConfig.rows;
                const visibleHeight = visibleRows * blockSize;

                // START CAMERA AT BOTTOM (showing rows 980-1000)
                // In a 1000-row grid: row 0 = TOP (goal), row 1000 = BOTTOM (starting point)
                // Initial camera should show bottom 20 rows (rows 980-1000)
                const STARTING_CAMERA_ROW = Math.max(0, totalRows - visibleRows);
                const initialTopRow = STARTING_CAMERA_ROW;
                const centerY = initialTopRow * blockSize + visibleHeight / 2;

                // Camera bounds encompass entire grid (will expand to 1000 rows)
                camera.setBounds(0, 0, width, totalRows * blockSize);
                camera.centerOn(width / 2, centerY);

                this.cameraSettings = {
                    visibleRows,
                    visibleHeight,
                    lerpSpeed: 0.08, // Smooth but responsive lerp speed
                    manualControl: false,
                    topPadding: 6,
                    bottomPadding: 0,
                    bottomKeepRows: 4,
                    pieceLeadRows: Math.ceil(visibleRows * 0.6), // 60% threshold
                    renderPadding: 4, // Extra rows to draw above/below the viewport
                    currentTopRow: initialTopRow,
                    targetTopRow: initialTopRow,
                    activeTopRow: initialTopRow,
                    centerRow: initialTopRow + visibleRows / 2,
                };
                // Buttery smooth camera lerp - slower lerp for smoother, more elegant transitions
                camera.setLerp(0.08, 0.08);

                if (this.gameState) {
                    this.gameState.cameraRow = initialTopRow;
                    this.gameState.cameraCenterRow = initialTopRow + visibleRows / 2;
                }

                console.log('[BaseBoardScene] Infinity camera initialized:');
                console.log(`  - Total rows: ${totalRows}`);
                console.log(`  - Showing rows ${initialTopRow} to ${initialTopRow + visibleRows}`);
                console.log(`  - Camera Y position: ${centerY}px`);
            } else {
                // Set the camera bounds to the entire logical canvas size
                camera.setBounds(0, 0, width, height);

                // Center the camera on the *visible* portion of the board, not the entire canvas.
                // This is done by offsetting the center point by the height of the hidden rows.
                const visibleHeight = height - hiddenRows * blockSize;
                camera.centerOn(width / 2, visibleHeight / 2 + hiddenRows * blockSize);

                this.cameraSettings = null;
            }
        }

        updateCameraPosition(targetRow, instant = false) {
            const camera = this.cameras?.main;
            if (!camera || !this.cameraSettings) return;

            this.updateCameraBounds();

            const { blockSize } = this.boardConfig;
            const totalRows = this.gameState?.board?.length
                ?? (this.rows + this.hiddenRows);
            const visibleRows = this.cameraSettings.visibleRows || this.rows;
            const bottomPadding = this.cameraSettings.bottomPadding ?? 0;

            const maxTopRow = Math.max(0, totalRows - visibleRows + bottomPadding);
            const clampedTarget = Math.max(0, Math.min(targetRow, maxTopRow));
            this.cameraSettings.targetTopRow = clampedTarget;

            const speed = this.cameraSettings.lerpSpeed ?? 0.08;
            if (this.cameraSettings.manualControl || instant) {
                this.cameraSettings.currentTopRow = clampedTarget;
            } else {
                this.cameraSettings.currentTopRow += (clampedTarget - this.cameraSettings.currentTopRow) * speed;
            }

            const currentTopRow = Math.max(0, Math.min(this.cameraSettings.currentTopRow, maxTopRow));
            const centerY = currentTopRow * blockSize + (visibleRows * blockSize) / 2;

            this.updateCameraBounds();

            const { width } = this.getBoardDimensions();
            camera.centerOn(width / 2, centerY);

            const centerRow = currentTopRow + visibleRows / 2;
            this.cameraSettings.centerRow = centerRow;
            this.cameraSettings.activeTopRow = currentTopRow;
            this.cameraSettings.currentTopRow = currentTopRow;

            if (this.gameState) {
                this.gameState.cameraRow = currentTopRow;
                this.gameState.cameraCenterRow = centerRow;
            }
        }

        updateCameraBounds() {
            const camera = this.cameras?.main;
            if (!camera || !this.cameraSettings) return;

            const { blockSize } = this.boardConfig;
            const totalRows = this.gameState?.board?.length
                ?? (this.rows + this.hiddenRows);
            const totalHeight = totalRows * blockSize;
            const { width } = this.getBoardDimensions();

            camera.setBounds(0, 0, width, totalHeight);
        }

        enableManualCameraControl() {
            if (!this.cameraSettings) return;
            this.cameraSettings.manualControl = true;
        }

        disableManualCameraControl() {
            if (!this.cameraSettings) return;
            this.cameraSettings.manualControl = false;
        }

        /**
         * Shake camera with default intensity scaled by multiplier.
         * @param {number} [multiplier=1]
         * @param {number} [duration=150]
         */
        shakeCamera(multiplier = 1, duration = 150) {
            const camera = this.cameras?.main;
            if (!camera) return;

            const now = performance.now();
            // Prevent overlapping shakes from stacking too aggressively.
            if (now - this.lastShakeTimestamp < duration * 0.5) {
                return;
            }

            const qualityMultiplier = this.qualityConfig?.shakeMultiplier ?? 1;
            camera.shake(duration, DEFAULT_SHAKE_INTENSITY * multiplier * qualityMultiplier);
            this.lastShakeTimestamp = now;
        }

        /**
         * Listen to Phaser scale events and adjust camera zoom/position.
         */
        registerResizeHandler() {
            // No-op. The FIT scale mode handles this automatically.
        }

        renderGameState() {
            if (!this.gameState) return;

            // PERFORMANCE: Dual-layer rendering optimization
            // Static content (boardGrid) only redraws when board changes
            // Dynamic content (current piece, ghost) redraws every frame

            // Static layer - only render when board is dirty
            if (this._boardDirty) {
                this.drawGrid();
                this.drawBoardFromGrid();
                this.drawLockedPieceOutlines();
            }

            // Dynamic layer - render every frame
            if (this.gameState.currentPiece) {
                this.drawGhostPiece();
            }
            this.drawAnimatedPieces();
            if (this.gameState.currentPiece) {
                this.drawCurrentPiece();
            }
        }

        drawGrid() {
            // Log once to verify optimization is active
            if (!this._fpsFixVerified) {
                console.log('[BaseBoardScene] ✅ MULTIPLAYER OPTIMIZATION ACTIVE: Graphics cleared once per frame in update()');
                this._fpsFixVerified = true;
            }

            // NOTE: All graphics layers (boardGraphics, pieceGraphics, effectsGraphics)
            // are now cleared in update() method at the START of each frame.
            // This matches the multiplayer implementation and prevents double-clearing.
            // No background fill needed - fully transparent.
        }

        drawBoardFromGrid() {
            const grid = this.gameState?.boardGrid;
            if (!grid) return;

            const { startRow, endRow } = this.getVisibleRowRange();

            // PERFORMANCE: Draw to static boardGraphics layer (only redraws when board changes)
            const staticLayer = this.boardGraphics;

            for (let worldY = startRow; worldY < endRow; worldY++) {
                const row = grid[worldY];
                if (!row) continue;

                for (let worldX = 0; worldX < this.cols; worldX++) {
                    const cell = row[worldX];
                    if (!cell) continue;

                    let colorValue = cell.color;
                    if (typeof colorValue === 'string' && COLORS[colorValue]) {
                        colorValue = COLORS[colorValue];
                    }

                    // Get themed color if cell has a type
                    if (cell.type) {
                        // Special handling for garbage: preserve player colors (non-gray)
                        // If garbage has a specific color (not default gray), don't override with theme
                        const isGarbage = cell.type === 'GARBAGE' || cell.type === 'CLEAN_GARBAGE';
                        const isCustomColor = cell.color && cell.color !== '#808080';

                        if (!isGarbage || !isCustomColor) {
                            colorValue = this.getThemedColor(cell.type, colorValue);
                        }
                    }

                    // Draw to static layer instead of dynamic pieceGraphics
                    this.drawBlock(worldX, worldY, colorValue, 1.0, false, null, 0, 0, staticLayer);
                }
            }
        }

        drawLockedPieceOutlines() {
            const grid = this.gameState?.boardGrid;
            if (!grid) return;

            // PERFORMANCE: Draw to static boardGraphics layer (only redraws when board changes)
            const staticLayer = this.boardGraphics;
            if (!staticLayer) return;

            // Draw extremely subtle outlines around locked pieces by detecting edges
            // Very low opacity (0.08) makes it barely visible but helps distinguish pieces
            staticLayer.lineStyle(0.5, 0x000000, 0.08);

            const { startRow, endRow } = this.getVisibleRowRange();

            for (let worldY = startRow; worldY < endRow; worldY++) {
                const row = grid[worldY];
                if (!row) continue;

                for (let worldX = 0; worldX < this.cols; worldX++) {
                    const cell = row[worldX];
                    if (!cell) continue;

                    const px = Math.round(worldX * this.blockSize);
                    const py = Math.round(worldY * this.blockSize);
                    const size = this.blockSize;

                    const pieceId = cell.id;

                    // Check each edge - only draw if the adjacent cell has a different piece ID
                    // Top edge
                    const topCell = worldY > 0 ? grid[worldY - 1]?.[worldX] : null;
                    if (!topCell || topCell.id !== pieceId) {
                        staticLayer.beginPath();
                        staticLayer.moveTo(px, py);
                        staticLayer.lineTo(px + size, py);
                        staticLayer.strokePath();
                        staticLayer.closePath();
                    }

                    // Bottom edge
                    const bottomCell = worldY < grid.length - 1 ? grid[worldY + 1]?.[worldX] : null;
                    if (!bottomCell || bottomCell.id !== pieceId) {
                        staticLayer.beginPath();
                        staticLayer.moveTo(px, py + size);
                        staticLayer.lineTo(px + size, py + size);
                        staticLayer.strokePath();
                        staticLayer.closePath();
                    }

                    // Left edge
                    const leftCell = worldX > 0 ? grid[worldY]?.[worldX - 1] : null;
                    if (!leftCell || leftCell.id !== pieceId) {
                        staticLayer.beginPath();
                        staticLayer.moveTo(px, py);
                        staticLayer.lineTo(px, py + size);
                        staticLayer.strokePath();
                        staticLayer.closePath();
                    }

                    // Right edge
                    const rightCell = worldX < this.cols - 1 ? grid[worldY]?.[worldX + 1] : null;
                    if (!rightCell || rightCell.id !== pieceId) {
                        staticLayer.beginPath();
                        staticLayer.moveTo(px + size, py);
                        staticLayer.lineTo(px + size, py + size);
                        staticLayer.strokePath();
                        staticLayer.closePath();
                    }
                }
            }
        }

        drawAnimatedPieces() {
            const pieces = this.gameState?.lockedPieces;
            if (!pieces) return;

            pieces
                .filter((piece) => piece?.isAnimating && typeof piece.animationOffset === 'number' && piece.animationOffset !== 0)
                .forEach((piece) => {
                    // Get themed color for this piece type
                    // Get themed color for this piece type
                    let themedColor = piece.color;

                    const isGarbage = piece.type === 'GARBAGE' || piece.type === 'CLEAN_GARBAGE';
                    const isCustomColor = piece.color && piece.color !== '#808080';

                    if (!isGarbage || !isCustomColor) {
                        themedColor = this.getThemedColor(piece.type, piece.color);
                    }

                    piece.shape.forEach((row, localY) => {
                        row.forEach((cell, localX) => {
                            if (cell <= 0) return;

                            const worldX = piece.x + localX;
                            const worldY = piece.y + localY + piece.animationOffset;

                            if ((!this.gameState?.isInfinityMode && worldY < this.hiddenRows) || worldY >= this.rows + this.hiddenRows) return;

                            this.drawBlock(worldX, worldY, themedColor, 1.0);
                        });
                    });
                });
        }

        drawGhostPiece() {
            const piece = this.gameState?.currentPiece;
            if (!piece) return;

            const ghostY = getGhostLandingY(this.gameState);

            piece.shape.forEach((row, y) => {
                row.forEach((cell, x) => {
                    if (cell > 0) {
                        const worldX = piece.x + x;
                        const worldY = ghostY + y;

                        if (this.gameState?.isInfinityMode || worldY >= this.hiddenRows) {
                            const minAlpha = 0.1;
                            const maxAlpha = 0.35;
                            const pulse = this._getPulseIntensity(worldX, worldY);
                            const pulsatingAlpha = minAlpha + (maxAlpha - minAlpha) * pulse;
                            this.drawBlock(worldX, worldY, '#FFFFFF', pulsatingAlpha, true);
                        }
                    }
                });
            });
        }

        drawCurrentPiece() {
            const piece = this.gameState?.currentPiece;
            if (!piece) return;

            // Get themed color for this piece type
            const themedColor = this.getThemedColor(piece.type, piece.color);

            // Draw all blocks of the piece as solid fill first
            piece.shape.forEach((row, y) => {
                row.forEach((cell, x) => {
                    if (cell > 0) {
                        const worldY = piece.y + y;
                        if (this.gameState?.isInfinityMode || worldY >= this.hiddenRows) {
                            this.drawBlock(piece.x + x, worldY, themedColor, 1.0, false, piece.shape, x, y);
                        }
                    }
                });
            });

            // Draw outline around the entire piece
            const tempPiece = {
                ...piece,
                y: piece.y, // Already in world coordinates
                x: piece.x,
            };
            this.drawPieceOutline(tempPiece);
        }

        /**
         * Draw a single block at the given grid position.
         * @param {number} x - Grid X position
         * @param {number} y - Grid Y position (world coordinates)
         * @param {string} color - Hex color string
         * @param {number} alpha - Opacity (0-1)
         * @param {boolean} isGhost - Whether this is a ghost piece block
         * @param {Object} shape - Piece shape (unused, kept for compatibility)
         * @param {number} localX - Local X in piece shape (unused)
         * @param {number} localY - Local Y in piece shape (unused)
         * @param {Phaser.GameObjects.Graphics} graphics - Target graphics layer (defaults to pieceGraphics)
         */
        drawBlock(x, y, color, alpha = 1.0, isGhost = false, shape = null, localX = 0, localY = 0, graphics = null) {
            // y is already in world coordinates (0-23), draw directly
            // The camera is positioned to show only the visible portion
            const px = Math.round(x * this.blockSize);
            const py = Math.round(y * this.blockSize);
            const size = this.blockSize;

            // Use specified graphics layer or default to pieceGraphics (dynamic layer)
            const targetGraphics = graphics || this.pieceGraphics;

            let colorInt = 0x808080;
            if (color && typeof color === 'string') {
                const parsed = parseInt(color.replace('#', ''), 16);
                if (!Number.isNaN(parsed)) {
                    colorInt = parsed;
                }
            }

            // --- Start of Ghost Piece Changes ---
            if (isGhost) {
                // Change from an outline to a semi-transparent fill
                targetGraphics.fillStyle(colorInt, alpha);
                targetGraphics.fillRect(px, py, size, size);
                return;
            }

            // Draw the solid color fill for the block (no individual borders)
            targetGraphics.fillStyle(colorInt, alpha);
            targetGraphics.fillRect(px, py, size, size);
        }

        /**
         * Draw outline around an entire tetromino piece
         * @param {Object} piece - The piece to outline
         */
        drawPieceOutline(piece) {
            if (!piece || !piece.shape) return;

            let colorInt = 0x000000;
            if (piece.color && typeof piece.color === 'string') {
                const parsed = parseInt(piece.color.replace('#', ''), 16);
                if (!Number.isNaN(parsed)) {
                    colorInt = parsed;
                }
            }

            // Draw extremely subtle borders only on the outer edges of the piece
            // Very low opacity (0.08) makes it barely visible but helps distinguish pieces
            this.pieceGraphics.lineStyle(0.5, 0x000000, 0.08);

            piece.shape.forEach((row, y) => {
                row.forEach((cell, x) => {
                    if (cell > 0) {
                        const worldX = piece.x + x;
                        const worldY = piece.y + y;

                        if (!this.gameState?.isInfinityMode && worldY < this.hiddenRows) return;

                        // Use world coordinates directly - camera handles the viewport
                        const px = Math.round(worldX * this.blockSize);
                        const py = Math.round(worldY * this.blockSize);
                        const size = this.blockSize;

                        // Check each edge - only draw if it's an outer edge
                        // Top edge
                        if (y === 0 || !piece.shape[y - 1] || !piece.shape[y - 1][x]) {
                            this.pieceGraphics.beginPath();
                            this.pieceGraphics.moveTo(px, py);
                            this.pieceGraphics.lineTo(px + size, py);
                            this.pieceGraphics.strokePath();
                            this.pieceGraphics.closePath();
                        }

                        // Bottom edge
                        if (y === piece.shape.length - 1 || !piece.shape[y + 1] || !piece.shape[y + 1][x]) {
                            this.pieceGraphics.beginPath();
                            this.pieceGraphics.moveTo(px, py + size);
                            this.pieceGraphics.lineTo(px + size, py + size);
                            this.pieceGraphics.strokePath();
                            this.pieceGraphics.closePath();
                        }

                        // Left edge
                        if (x === 0 || !piece.shape[y][x - 1]) {
                            this.pieceGraphics.beginPath();
                            this.pieceGraphics.moveTo(px, py);
                            this.pieceGraphics.lineTo(px, py + size);
                            this.pieceGraphics.strokePath();
                            this.pieceGraphics.closePath();
                        }

                        // Right edge
                        if (x === row.length - 1 || !piece.shape[y][x + 1]) {
                            this.pieceGraphics.beginPath();
                            this.pieceGraphics.moveTo(px + size, py);
                            this.pieceGraphics.lineTo(px + size, py + size);
                            this.pieceGraphics.strokePath();
                            this.pieceGraphics.closePath();
                        }
                    }
                });
            });
        }

        _getPulseIntensity(gridX, gridY) {
            const timestamp = this.scene.systems.time.now;
            const PULSE_SPEED = 0.005; // You can make this faster or slower
            const POSITION_PHASE_SHIFT = 0.45;
            const phase = timestamp * PULSE_SPEED + (gridX + gridY) * POSITION_PHASE_SHIFT;
            return 0.5 + 0.5 * Math.sin(phase); // Result is a value between 0.0 and 1.0
        }

        lightenColor(color, amount) {
            const r = Math.min(255, ((color >> 16) & 0xff) + amount * 255);
            const g = Math.min(255, ((color >> 8) & 0xff) + amount * 255);
            const b = Math.min(255, (color & 0xff) + amount * 255);
            return (r << 16) | (g << 8) | b;
        }

        darkenColor(color, amount) {
            const r = Math.max(0, ((color >> 16) & 0xff) - amount * 255);
            const g = Math.max(0, ((color >> 8) & 0xff) - amount * 255);
            const b = Math.max(0, (color & 0xff) - amount * 255);
            return (r << 16) | (g << 8) | b;
        }

        /**
         * PERFORMANCE: Periodic cleanup to prevent memory leaks
         * Called every ~3 seconds to clean up accumulated resources
         * Fixes time-based FPS degradation issue
         * @private
         */
        _performPeriodicCleanup() {
            // PERFORMANCE NOTE: Tween cleanup removed - killAll() was killing active tweens
            // and causing ripple effects to get stuck. Phaser 4 manages tween lifecycle.

            // CRITICAL FIX #1: Clean up tracked objects in SharedEffects
            if (this.sharedEffects && this.sharedEffects._cleanupTrackedObjects) {
                try {
                    this.sharedEffects._cleanupTrackedObjects();
                } catch (e) {
                    // Ignore cleanup errors
                }
            }

            // CRITICAL FIX #2: Clean up particle systems
            if (this.sharedEffects && this.sharedEffects.activeParticleSystems) {
                try {
                    const particleArray = Array.from(this.sharedEffects.activeParticleSystems);
                    particleArray.forEach((emitter) => {
                        // Check if emitter is actually dead/stopped
                        if (emitter && emitter.on === false) {
                            this.sharedEffects.activeParticleSystems.delete(emitter);
                        }
                    });
                } catch (e) {
                    // Ignore cleanup errors
                }
            }
        }

        /**
         * Remove listeners on shutdown.
         */
        shutdown() {
            if (this.scale) {
                this.scale.off('resize');
            }

            // Cleanup style manager
            if (this.styleManager) {
                this.styleManager.destroy();
                this.styleManager = null;
            }

            // Final cleanup on shutdown
            this._performPeriodicCleanup();
            this._firstRenderEmitted = false;
        }

        _emitFirstRender() {
            this._firstRenderEmitted = true;
            this.events?.emit?.('first-render', { sceneKey: this.sceneKey });

            if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('phaser-board-first-render', {
                    detail: { sceneKey: this.sceneKey },
                }));
            }
        }

        /**
         * Sync scene with latest game state.
         * Child scenes can extend but should call super.syncFromGameState.
         * @param {Object} gameState
         */
        syncFromGameState(gameState) {
            const previousMode = this.gameState?.isInfinityMode;
            this.gameState = gameState;

            // Check if we need to reconfigure camera (e.g. switching to/from infinity mode)
            // or if it's the first sync and camera isn't configured for infinity yet
            const currentMode = gameState?.isInfinityMode;
            if (previousMode !== currentMode || (currentMode && !this.cameraSettings)) {
                this.configureCamera();
            }
        }
    }

    cachedBaseClass = BaseBoardScene;
    cachedPhaserRef = PhaserRef;
    return BaseBoardScene;
}
