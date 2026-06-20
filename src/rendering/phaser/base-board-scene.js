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
                // Blind veil is dynamic (alpha fades each frame); always clear.
                this.blindGraphics?.clear();

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
                // Blind veil sits ABOVE the locked stack but BELOW the active
                // piece/ghost, so a blinded board stays playable.
                this.graphicsLayers.blind = this.add.graphics();
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
            this.blindGraphics = this.graphicsLayers.blind;
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
                // drawLockedPieceOutlines intentionally removed: pieces render as fused shapes with no internal borders
            }

            // Dynamic layer - render every frame
            if (this.gameState.currentPiece) {
                this.drawGhostPiece();
            }
            this.drawAnimatedPieces();
            if (this.gameState.currentPiece) {
                this.drawCurrentPiece();
            }

            // Quadra blind veil — drawn every frame (alpha fades); the blind layer
            // sits below the piece layer so the active piece/ghost stay visible.
            this.drawBlindOverlay();
        }

        /**
         * Eases the veil alpha toward 0 over the last ~25% of the timer for a
         * smooth reveal. Full opacity otherwise.
         * @param {number} ratio - remaining/original duration (0..1)
         */
        _blindFade(ratio) {
            if (ratio <= 0) return 0;
            if (ratio >= 0.25) return 1;
            return ratio / 0.25;
        }

        /**
         * Draws the Quadra blind blackout from gameState.blindTimers onto the
         * dedicated (dynamic, always-cleared) blind layer.
         *   - full blind (field):   veil the whole visible locked stack
         *   - partial blind (pending): veil only the garbage rows
         * Render-only: never touches board/collision state.
         */
        drawBlindOverlay() {
            const layer = this.blindGraphics;
            const gs = this.gameState;
            const bt = gs?.blindTimers;
            if (!layer || !bt) return;

            const fieldActive = (bt.field || 0) > 0;
            const pendingActive = (bt.pending || 0) > 0;
            if (!fieldActive && !pendingActive) return;

            const { startRow, endRow } = this.getVisibleRowRange();
            const isInfinity = !!gs.isInfinityMode;
            const minRow = isInfinity ? startRow : Math.max(startRow, this.hiddenRows);
            const bs = this.blockSize;
            const VEIL = 0x05070d; // near-black with a faint cool tint
            const MAX_ALPHA = 0.92;

            if (fieldActive) {
                // FULL BLIND: one rect over the whole visible play area.
                const ratio = bt.fieldMax > 0 ? bt.field / bt.fieldMax : 1;
                const alpha = MAX_ALPHA * this._blindFade(ratio);
                if (alpha <= 0) return;
                const y = Math.round(minRow * bs);
                const h = Math.round(endRow * bs) - y;
                layer.fillStyle(VEIL, alpha);
                layer.fillRect(0, y, Math.round(this.cols * bs), h);
                return;
            }

            // PARTIAL BLIND: veil only garbage cells in the locked stack.
            const grid = gs.boardGrid;
            if (!grid) return;
            const ratio = bt.pendingMax > 0 ? bt.pending / bt.pendingMax : 1;
            const alpha = MAX_ALPHA * this._blindFade(ratio);
            if (alpha <= 0) return;
            layer.fillStyle(VEIL, alpha);
            for (let worldY = minRow; worldY < endRow; worldY++) {
                const row = grid[worldY];
                if (!row) continue;
                for (let worldX = 0; worldX < this.cols; worldX++) {
                    const cell = row[worldX];
                    if (!cell) continue;
                    if (cell.type !== 'GARBAGE' && cell.type !== 'CLEAN_GARBAGE') continue;
                    const px = Math.round(worldX * bs);
                    const py = Math.round(worldY * bs);
                    const w = Math.round((worldX + 1) * bs) - px;
                    const h = Math.round((worldY + 1) * bs) - py;
                    layer.fillRect(px, py, w, h);
                }
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
            const staticLayer = this.boardGraphics;
            if (!staticLayer) return;

            const { startRow, endRow } = this.getVisibleRowRange();
            const isInfinity = !!this.gameState?.isInfinityMode;
            const minRow = isInfinity ? startRow : Math.max(startRow, this.hiddenRows);
            const range = Math.max(1, endRow - startRow);
            const bs = this.blockSize;

            // Resolve themed color once per (type|color), with garbage special-casing.
            // Pooled across frames (cleared each draw) to avoid a per-frame Map allocation.
            if (!this._poolColorCache) this._poolColorCache = new Map();
            const colorCache = this._poolColorCache;
            colorCache.clear();
            const resolveColor = (cell) => {
                const cacheKey = `${cell.type}|${cell.color}`;
                const cached = colorCache.get(cacheKey);
                if (cached) return cached;
                let colorValue = cell.color;
                if (typeof colorValue === 'string' && COLORS[colorValue]) colorValue = COLORS[colorValue];
                const isGarbage = cell.type === 'GARBAGE' || cell.type === 'CLEAN_GARBAGE';
                const isCustomColor = cell.color && cell.color !== '#808080';
                if (!isGarbage || !isCustomColor) colorValue = this.getThemedColor(cell.type, colorValue);
                const resolved = { colorInt: this.colorToInt(colorValue), isGarbage };
                colorCache.set(cacheKey, resolved);
                return resolved;
            };

            // Continuous vertical light ramp across the stack (top lighter → bottom
            // darker). A pure function of worldY, so vertically/horizontally adjacent
            // same-color cells always match at their shared edge → zero seams.
            const shadeAt = (worldY) => 0.1 * (1 - 2 * ((worldY - startRow) / range));

            // ---- Body: per-cell overlapping rects (seamless, topology-proof) ----
            for (let worldY = minRow; worldY < endRow; worldY++) {
                const row = grid[worldY];
                if (!row) continue;
                for (let worldX = 0; worldX < this.cols; worldX++) {
                    const cell = row[worldX];
                    if (!cell) continue;
                    const { colorInt, isGarbage } = resolveColor(cell);
                    const px = Math.round(worldX * bs);
                    const py = Math.round(worldY * bs);
                    const w = Math.round((worldX + 1) * bs) - px;
                    const h = Math.round((worldY + 1) * bs) - py;
                    if (isGarbage) {
                        staticLayer.fillStyle(colorInt, 1); // matte
                    } else {
                        const top = this._shadeColor(colorInt, shadeAt(worldY));
                        const bot = this._shadeColor(colorInt, shadeAt(worldY + 1));
                        staticLayer.fillGradientStyle(top, top, bot, bot, 1, 1, 1, 1);
                    }
                    staticLayer.fillRect(px - 0.25, py - 0.25, w + 0.5, h + 0.5);
                }
            }

            // ---- Rim: outer perimeter of each fused same-color region only ----
            const rimFx = this._pieceFx('T');
            if (!rimFx.rim) return;
            const width = Math.max(1, bs * rimFx.rimWidthFactor);
            // Pooled across frames (cleared each draw) — avoids a per-frame Set allocation.
            if (!this._poolVisited) this._poolVisited = new Set();
            const visited = this._poolVisited;
            visited.clear();
            for (let worldY = minRow; worldY < endRow; worldY++) {
                const row = grid[worldY];
                if (!row) continue;
                for (let worldX = 0; worldX < this.cols; worldX++) {
                    const cell = row[worldX];
                    if (!cell) continue;
                    const key = `${worldX},${worldY}`;
                    if (visited.has(key)) continue;
                    visited.add(key);
                    const { colorInt, isGarbage } = resolveColor(cell);
                    if (isGarbage) continue; // garbage has no rim
                    // Flood-fill the connected same-color region (visible band only).
                    // Pooled across regions/frames (cleared per region) to kill the
                    // per-region Set/array churn that spiked GC during big cascades.
                    if (!this._poolGroup) this._poolGroup = new Set();
                    const group = this._poolGroup;
                    group.clear();
                    group.add(key);
                    if (!this._poolStack) this._poolStack = [];
                    const stack = this._poolStack;
                    stack.length = 0;
                    stack.push([worldX, worldY]);
                    while (stack.length) {
                        const [cx, cy] = stack.pop();
                        for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]]) {
                            if (nx < 0 || nx >= this.cols || ny < minRow || ny >= endRow) continue;
                            const nk = `${nx},${ny}`;
                            if (visited.has(nk)) continue;
                            const ncell = grid[ny]?.[nx];
                            if (!ncell) continue;
                            const nc = resolveColor(ncell);
                            if (nc.isGarbage || nc.colorInt !== colorInt) continue;
                            visited.add(nk);
                            group.add(nk);
                            stack.push([nx, ny]);
                        }
                    }
                    const loops = this.traceLoops(group, 0, 0);
                    this.strokeLoops(staticLayer, loops, 0xffffff, width, rimFx.rimAlpha * 0.6);
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

            const skipHiddenRows = !this.gameState?.isInfinityMode;

            pieces
                .filter((piece) => piece?.isAnimating && typeof piece.animationOffset === 'number' && piece.animationOffset !== 0)
                .forEach((piece) => {
                    let colorValue = piece.color;
                    const isGarbage = piece.type === 'GARBAGE' || piece.type === 'CLEAN_GARBAGE';
                    const isCustomColor = piece.color && piece.color !== '#808080';
                    if (!isGarbage || !isCustomColor) {
                        colorValue = this.getThemedColor(piece.type, piece.color);
                    }
                    const colorInt = this.colorToInt(colorValue);
                    // Garbage stays matte (no gradient/rim); playable pieces get depth.
                    const fx = isGarbage
                        ? { gradient: false, rim: false, gloss: false }
                        : this._pieceFx(piece.type);
                    // Animated pieces shift by a fractional animationOffset.
                    this.drawFusedPiece(
                        this.pieceGraphics, piece.shape, piece.x, piece.y + piece.animationOffset,
                        colorInt, { alpha: 1, fx, gloss: false, skipHiddenRows },
                    );
                });
        }

        drawGhostPiece() {
            const piece = this.gameState?.currentPiece;
            if (!piece) return;

            const ghostY = getGhostLandingY(this.gameState);
            const skipHiddenRows = !this.gameState?.isInfinityMode;

            // The ghost is a single translucent silhouette — NO gradient/gloss/rim
            // depth (that would turn it into a bright box competing with the active
            // piece). One shared pulse alpha across all cells keeps it fused.
            const minAlpha = 0.1;
            const maxAlpha = 0.35;
            const pieceCenterX = Math.floor(piece.x + piece.shape[0].length / 2);
            const pieceCenterY = Math.floor(ghostY + piece.shape.length / 2);
            // Reduced motion: freeze the pulse at its midpoint.
            const pulse = this._reducedMotion() ? 0.5 : this._getPulseIntensity(pieceCenterX, pieceCenterY);
            const alpha = minAlpha + (maxAlpha - minAlpha) * pulse;

            const present = this._presentCells(piece.shape, ghostY, skipHiddenRows);
            const loops = this.traceLoops(present, piece.x, ghostY);
            // Translucent fill MUST use the single contour polygon — per-cell rects
            // double-cover at their overlap and produce brighter internal seam lines.
            this.fillContour(this.pieceGraphics, loops, 0xffffff, alpha);
            // A faint cyan outer outline is the ghost's only edge treatment.
            this.strokeLoops(this.pieceGraphics, loops, 0x64c8ff, 1, alpha * 0.7);
        }

        drawCurrentPiece() {
            const piece = this.gameState?.currentPiece;
            if (!piece) return;

            const themedColor = this.getThemedColor(piece.type, piece.color);
            const colorInt = this.colorToInt(themedColor);
            const fx = this._pieceFx(piece.type);
            const skipHiddenRows = !this.gameState?.isInfinityMode;

            // Active piece gets the full premium treatment: continuous gradient,
            // top gloss sheen, and an outer rim — all on the fused silhouette only.
            this.drawFusedPiece(this.pieceGraphics, piece.shape, piece.x, piece.y, colorInt, {
                alpha: 1, fx, gloss: true, skipHiddenRows,
            });
        }

        /**
         * Trace the outer boundary of a piece shape as a pixel-space polygon.
         * Works by collecting every outer edge segment (where an adjacent cell is absent),
         * then chaining them into a single closed path.  Tetrominos are simply connected,
         * so the chain always forms one polygon.
         *
         * @param {Array<Array<number>>} shape - 2-D piece shape matrix (1 = filled, 0 = empty)
         * @param {number} originX - Grid X of the piece's top-left corner
         * @param {number} originY - Grid Y of the piece's top-left corner
         * @param {number} [minWorldY=0] - Only include cells at worldY >= this (hidden-row clipping)
         * @returns {Array<{x:number, y:number}>} Ordered polygon vertices in pixel coordinates
         */
        buildOuterContour(shape, originX, originY, minWorldY = 0) {
            const bs = this.blockSize;
            const has = (lx, ly) =>
                ly >= 0 && ly < shape.length &&
                lx >= 0 && lx < (shape[0]?.length ?? 0) &&
                shape[ly][lx] > 0;

            // Collect directed outer-edge segments (CW winding).
            // Direction for each face ensures the final polygon is clockwise.
            const edges = [];
            shape.forEach((row, ly) => {
                const worldY = originY + ly;
                if (!this.gameState?.isInfinityMode && worldY < minWorldY) return;
                row.forEach((cell, lx) => {
                    if (!cell) return;
                    const x0 = Math.round((originX + lx) * bs);
                    const y0 = Math.round((originY + ly) * bs);
                    const x1 = Math.round((originX + lx + 1) * bs);
                    const y1 = Math.round((originY + ly + 1) * bs);
                    if (!has(lx, ly - 1)) edges.push({ fx: x0, fy: y0, tx: x1, ty: y0 }); // top
                    if (!has(lx + 1, ly)) edges.push({ fx: x1, fy: y0, tx: x1, ty: y1 }); // right
                    if (!has(lx, ly + 1)) edges.push({ fx: x1, fy: y1, tx: x0, ty: y1 }); // bottom
                    if (!has(lx - 1, ly)) edges.push({ fx: x0, fy: y1, tx: x0, ty: y0 }); // left
                });
            });

            if (edges.length === 0) return [];

            const edgeMap = new Map();
            edges.forEach((e) => edgeMap.set(`${e.fx},${e.fy}`, e));

            const points = [];
            let current = edges[0];
            const startKey = `${edges[0].fx},${edges[0].fy}`;
            do {
                points.push({ x: current.fx, y: current.fy });
                current = edgeMap.get(`${current.tx},${current.ty}`);
                if (!current) break;
            } while (`${current.fx},${current.fy}` !== startKey);

            return points;
        }

        /**
         * Fill a polygon produced by buildOuterContour using Phaser Graphics path API.
         * A single fillPath call — no internal seams possible.
         * @param {Phaser.GameObjects.Graphics} graphics
         * @param {Array<{x:number,y:number}>} points
         * @param {number} colorInt   - integer color (0xRRGGBB)
         * @param {number} [alpha=1]
         */
        fillFusedShape(graphics, points, colorInt, alpha = 1) {
            if (!graphics || points.length < 3) return;
            graphics.fillStyle(colorInt, alpha);
            graphics.beginPath();
            graphics.moveTo(points[0].x, points[0].y);
            for (let i = 1; i < points.length; i++) {
                graphics.lineTo(points[i].x, points[i].y);
            }
            graphics.closePath();
            graphics.fillPath();
        }

        /**
         * Resolve a color string to an integer, falling back to mid-grey.
         * @param {string} color
         * @returns {number}
         */
        colorToInt(color) {
            if (!color || typeof color !== 'string') return 0x808080;
            const parsed = parseInt(color.replace('#', ''), 16);
            return Number.isNaN(parsed) ? 0x808080 : parsed;
        }

        // =====================================================================
        // FUSED PIECE RENDERING (premium depth, no internal seams)
        // See docs/tetromino-visual-upgrade-plan.md. Body fills as per-cell
        // overlapping opaque rects (topology-proof, never a diagonal); depth is
        // applied only as a continuous whole-shape gradient + outer-perimeter rim.
        // =====================================================================

        /** Whether to soften animated effects for accessibility. */
        _reducedMotion() {
            try {
                if (typeof window !== 'undefined') {
                    if (window.settingsManager?.get?.().reducedMotion) return true;
                    if (typeof window.matchMedia === 'function') {
                        return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
                    }
                }
            } catch (e) { /* ignore */ }
            return false;
        }

        /**
         * Resolve premium effect parameters for a piece type from the theme.
         * Themes opt out by setting renderMode 'flat' or effects.premium === false.
         */
        _pieceFx(pieceType) {
            // NOTE: keep these in sync with the Canvas-2D next-queue values in
            // canvas-drawing-utils.js (PIECE_DEPTH) so previews match the board.
            const DEF = {
                gradient: true,
                highlight: 0.18, // lighten amount (0..1) at top-left
                shadow: 0.18, // darken amount (0..1) at bottom-right
                rim: true,
                rimAlpha: 0.42,
                rimWidthFactor: 0.05,
                gloss: true,
                glossAlpha: 0.22,
            };
            try {
                if (this.styleManager?.getPhaserEffects) {
                    return { ...DEF, ...this.styleManager.getPhaserEffects(pieceType) };
                }
            } catch (e) { /* ignore */ }
            return DEF;
        }

        /** Shade an int color: amount>0 lightens, amount<0 darkens. */
        _shadeColor(colorInt, amount) {
            if (!amount) return colorInt;
            return amount > 0
                ? this.lightenColor(colorInt, amount)
                : this.darkenColor(colorInt, -amount);
        }

        /** Linear-interpolate two int colors. */
        _lerpColor(c1, c2, t) {
            const r1 = (c1 >> 16) & 0xff; const g1 = (c1 >> 8) & 0xff; const b1 = c1 & 0xff;
            const r2 = (c2 >> 16) & 0xff; const g2 = (c2 >> 8) & 0xff; const b2 = c2 & 0xff;
            const r = Math.round(r1 + (r2 - r1) * t);
            const g = Math.round(g1 + (g2 - g1) * t);
            const b = Math.round(b1 + (b2 - b1) * t);
            return (r << 16) | (g << 8) | b;
        }

        /** Bilinear color sample from 4 corner colors at normalized (u,v). */
        _bilerpColor(tl, tr, bl, br, u, v) {
            return this._lerpColor(this._lerpColor(tl, tr, u), this._lerpColor(bl, br, u), v);
        }

        /**
         * Collect present (filled + visible) cells of a shape into a Set keyed
         * "lx,ly", honouring the per-cell hidden-row skip (consistent with the
         * contour's neighbour test, which fixes the spawn-time diagonal).
         */
        _presentCells(shape, originY, skipHiddenRows) {
            const set = new Set();
            const minWorldY = skipHiddenRows ? this.hiddenRows : -Infinity;
            for (let ly = 0; ly < shape.length; ly++) {
                const row = shape[ly];
                if (!row) continue;
                if ((originY + ly) < minWorldY) continue;
                for (let lx = 0; lx < row.length; lx++) {
                    if (row[lx] > 0) set.add(`${lx},${ly}`);
                }
            }
            return set;
        }

        /** Pixel rect for a local cell, with 0.5px overlap to fuse seams. */
        _cellRect(originX, originY, lx, ly) {
            const bs = this.blockSize;
            const px = Math.round((originX + lx) * bs);
            const py = Math.round((originY + ly) * bs);
            const w = Math.round((originX + lx + 1) * bs) - px;
            const h = Math.round((originY + ly + 1) * bs) - py;
            return { px, py, w, h };
        }

        /**
         * Body fill — per-cell overlapping opaque rects in one pass. Seamless,
         * topology-proof. Optional continuous TL→BR gradient across the whole
         * shape (computed in piece-bbox space so it never breaks at a cell edge).
         */
        fillFusedBody(graphics, presentSet, originX, originY, colorInt, alpha, fx) {
            if (!graphics || presentSet.size === 0) return;
            const cells = [];
            let minLx = Infinity; let minLy = Infinity; let maxLx = -Infinity; let maxLy = -Infinity;
            presentSet.forEach((key) => {
                const [lx, ly] = key.split(',').map(Number);
                cells.push([lx, ly]);
                if (lx < minLx) minLx = lx;
                if (ly < minLy) minLy = ly;
                if (lx > maxLx) maxLx = lx;
                if (ly > maxLy) maxLy = ly;
            });
            const bw = (maxLx - minLx + 1) || 1;
            const bh = (maxLy - minLy + 1) || 1;
            const useGradient = fx && fx.gradient;

            // bbox corner tints for the diagonal light ramp
            const cTL = useGradient ? this._shadeColor(colorInt, fx.highlight) : colorInt;
            const cBR = useGradient ? this._shadeColor(colorInt, -fx.shadow) : colorInt;
            const cTR = colorInt;
            const cBL = colorInt;

            if (!useGradient) graphics.fillStyle(colorInt, alpha);

            cells.forEach(([lx, ly]) => {
                const { px, py, w, h } = this._cellRect(originX, originY, lx, ly);
                if (useGradient) {
                    const u0 = (lx - minLx) / bw; const u1 = (lx - minLx + 1) / bw;
                    const v0 = (ly - minLy) / bh; const v1 = (ly - minLy + 1) / bh;
                    const tl = this._bilerpColor(cTL, cTR, cBL, cBR, u0, v0);
                    const tr = this._bilerpColor(cTL, cTR, cBL, cBR, u1, v0);
                    const bl = this._bilerpColor(cTL, cTR, cBL, cBR, u0, v1);
                    const br = this._bilerpColor(cTL, cTR, cBL, cBR, u1, v1);
                    graphics.fillGradientStyle(tl, tr, bl, br, alpha, alpha, alpha, alpha);
                }
                graphics.fillRect(px - 0.25, py - 0.25, w + 0.5, h + 0.5);
            });
        }

        /**
         * Gloss sheen — a continuous white vertical highlight, brightest at the
         * top of the shape, fading to nothing by the vertical midpoint. ADD blend.
         * Continuous across cells (no seams).
         */
        glossPass(graphics, presentSet, originX, originY, glossAlpha) {
            if (!graphics || presentSet.size === 0 || glossAlpha <= 0) return;
            const PhaserRef = window.Phaser;
            let minLy = Infinity; let maxLy = -Infinity;
            presentSet.forEach((key) => {
                const ly = Number(key.split(',')[1]);
                if (ly < minLy) minLy = ly;
                if (ly > maxLy) maxLy = ly;
            });
            const bh = (maxLy - minLy + 1) || 1;
            const sheenSpan = Math.max(1, bh * 0.55); // sheen reaches ~55% down
            const alphaAt = (ly) => {
                const t = (ly - minLy) / sheenSpan;
                return Math.max(0, glossAlpha * (1 - t));
            };
            if (graphics.setBlendMode && PhaserRef?.BlendModes?.ADD) {
                graphics.setBlendMode(PhaserRef.BlendModes.ADD);
            }
            presentSet.forEach((key) => {
                const [lx, ly] = key.split(',').map(Number);
                const aTop = alphaAt(ly);
                const aBot = alphaAt(ly + 1);
                if (aTop <= 0 && aBot <= 0) return;
                const { px, py, w, h } = this._cellRect(originX, originY, lx, ly);
                graphics.fillGradientStyle(0xffffff, 0xffffff, 0xffffff, 0xffffff, aTop, aTop, aBot, aBot);
                graphics.fillRect(px - 0.25, py - 0.25, w + 0.5, h + 0.5);
            });
            if (graphics.setBlendMode && PhaserRef?.BlendModes?.NORMAL !== undefined) {
                graphics.setBlendMode(PhaserRef.BlendModes.NORMAL);
            }
        }

        /**
         * Trace the outer perimeter(s) of a present-cell set as one or more closed
         * loops (handles concave shapes and holes). Used ONLY for the rim stroke,
         * never the body fill. Robust: the neighbour test uses the same present set,
         * so the edge graph is always consistent (no dropped edges / diagonals).
         * @returns {Array<Array<{x:number,y:number}>>} loops in pixel coords
         */
        traceLoops(presentSet, originX, originY) {
            const bs = this.blockSize;
            const has = (lx, ly) => presentSet.has(`${lx},${ly}`);
            const edges = [];
            presentSet.forEach((key) => {
                const [lx, ly] = key.split(',').map(Number);
                const x0 = (originX + lx) * bs; const y0 = (originY + ly) * bs;
                const x1 = (originX + lx + 1) * bs; const y1 = (originY + ly + 1) * bs;
                if (!has(lx, ly - 1)) edges.push({ fx: x0, fy: y0, tx: x1, ty: y0, dx: 1, dy: 0 });
                if (!has(lx + 1, ly)) edges.push({ fx: x1, fy: y0, tx: x1, ty: y1, dx: 0, dy: 1 });
                if (!has(lx, ly + 1)) edges.push({ fx: x1, fy: y1, tx: x0, ty: y1, dx: -1, dy: 0 });
                if (!has(lx - 1, ly)) edges.push({ fx: x0, fy: y1, tx: x0, ty: y0, dx: 0, dy: -1 });
            });
            if (edges.length === 0) return [];

            // Pooled across calls (cleared each call) — traceLoops runs per fused region.
            if (!this._poolStartMap) this._poolStartMap = new Map();
            const startMap = this._poolStartMap;
            startMap.clear();
            edges.forEach((e) => {
                const k = `${e.fx},${e.fy}`;
                if (!startMap.has(k)) startMap.set(k, []);
                startMap.get(k).push(e);
            });

            // Prefer the most-clockwise continuation (interior on the right) so any
            // genuine pinch resolves to a simple loop rather than a self-crossing.
            const turnScore = (din, c) => {
                const cross = din.dx * c.dy - din.dy * c.dx;
                const dot = din.dx * c.dx + din.dy * c.dy;
                if (cross > 0) return 0; // right turn (clockwise in y-down)
                if (cross === 0 && dot > 0) return 1; // straight
                if (cross < 0) return 2; // left turn
                return 3; // reverse
            };

            if (!this._poolUsed) this._poolUsed = new Set();
            const used = this._poolUsed;
            used.clear();
            const loops = [];
            edges.forEach((startEdge) => {
                if (used.has(startEdge)) return;
                const loop = [];
                let e = startEdge;
                let guard = 0;
                while (e && !used.has(e) && guard++ < 100000) {
                    used.add(e);
                    loop.push({ x: e.fx, y: e.fy });
                    const candidates = startMap.get(`${e.tx},${e.ty}`) || [];
                    let best = null; let bestScore = 99;
                    for (const c of candidates) {
                        if (used.has(c)) continue;
                        const s = turnScore(e, c);
                        if (s < bestScore) { bestScore = s; best = c; }
                    }
                    e = best;
                }
                if (loop.length >= 3) loops.push(loop);
            });
            return loops;
        }

        /** Stroke one or more perimeter loops (the outer rim). */
        strokeLoops(graphics, loops, colorInt, width, alpha) {
            if (!graphics || !loops || loops.length === 0 || alpha <= 0) return;
            graphics.lineStyle(width, colorInt, alpha);
            loops.forEach((loop) => {
                if (loop.length < 2) return;
                graphics.beginPath();
                graphics.moveTo(loop[0].x, loop[0].y);
                for (let i = 1; i < loop.length; i++) graphics.lineTo(loop[i].x, loop[i].y);
                graphics.closePath();
                graphics.strokePath();
            });
        }

        /**
         * Fill a fused shape as a single contour polygon (one fillPath). Unlike the
         * per-cell rect fill, this is correct for TRANSLUCENT fills (the ghost),
         * where overlapping rects would double-cover and show brighter seam lines.
         */
        fillContour(graphics, loops, colorInt, alpha) {
            if (!graphics || !loops || loops.length === 0 || alpha <= 0) return;
            graphics.fillStyle(colorInt, alpha);
            graphics.beginPath();
            loops.forEach((loop) => {
                if (loop.length < 3) return;
                graphics.moveTo(loop[0].x, loop[0].y);
                for (let i = 1; i < loop.length; i++) graphics.lineTo(loop[i].x, loop[i].y);
                graphics.closePath();
            });
            graphics.fillPath();
        }

        /**
         * Draw one fused piece (active or animated) with premium depth.
         * Body → gradient/flat; optional gloss; optional outer rim. Seam-free.
         */
        drawFusedPiece(graphics, shape, originX, originY, colorInt, opts = {}) {
            const {
                alpha = 1, fx = null, gloss = false, skipHiddenRows = true,
            } = opts;
            const present = this._presentCells(shape, originY, skipHiddenRows);
            if (present.size === 0) return;
            this.fillFusedBody(graphics, present, originX, originY, colorInt, alpha, fx);
            if (gloss && fx && fx.gloss) {
                this.glossPass(graphics, present, originX, originY, fx.glossAlpha);
            }
            if (fx && fx.rim) {
                const loops = this.traceLoops(present, originX, originY);
                const width = Math.max(1, this.blockSize * fx.rimWidthFactor);
                this.strokeLoops(graphics, loops, 0xffffff, width, fx.rimAlpha * alpha);
            }
        }

        /**
         * Draw a single block at the given grid position.
         * @param {number} x - Grid X position
         * @param {number} y - Grid Y position (world coordinates)
         * @param {string} color - Hex color string
         * @param {number} alpha - Opacity (0-1)
         * @param {boolean} isGhost - Whether this is a ghost piece block
         * @param {Object} shape - Piece shape
         * @param {number} localX - Local X in piece shape
         * @param {number} localY - Local Y in piece shape
         * @param {Phaser.GameObjects.Graphics} graphics - Target graphics layer
         */
        // eslint-disable-next-line no-unused-vars
        drawBlock(x, y, color, alpha = 1.0, isGhost = false, shape = null, localX = 0, localY = 0, graphics = null) {
            // Calculate pixel-perfect coordinates to prevent subpixel antialiasing gaps
            const px = Math.round(x * this.blockSize);
            const py = Math.round(y * this.blockSize);
            const pxNext = Math.round((x + 1) * this.blockSize);
            const pyNext = Math.round((y + 1) * this.blockSize);
            const width = pxNext - px;
            const height = pyNext - py;

            // Use specified graphics layer or default to pieceGraphics (dynamic layer)
            const targetGraphics = graphics || this.pieceGraphics;

            let colorInt = 0x808080;
            if (color && typeof color === 'string') {
                const parsed = parseInt(color.replace('#', ''), 16);
                if (!Number.isNaN(parsed)) {
                    colorInt = parsed;
                }
            }

            if (isGhost) {
                // Ghost pieces use semi-transparent fills without overlap to prevent darker overlap lines
                targetGraphics.fillStyle(colorInt, alpha);
                targetGraphics.fillRect(px, py, width, height);
                return;
            }

            // Draw solid blocks with a tiny 0.25px overlap to guarantee perfect visual fusion with no seams
            targetGraphics.fillStyle(colorInt, alpha);
            targetGraphics.fillRect(px - 0.25, py - 0.25, width + 0.5, height + 0.5);
        }

        /**
         * Draw outline around an entire tetromino piece
         * @param {Object} piece - The piece to outline
         */
        drawPieceOutline(piece) {
            if (!piece || !piece.shape) return;

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
