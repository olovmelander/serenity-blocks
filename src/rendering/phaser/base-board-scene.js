import {
    COLS, ROWS, HIDDEN_ROWS, BLOCK_SIZE,
} from '../../core/constants.js';
import { ensureCircleTexture } from './utils/index.js';
import { getQualityConfig, normalizeQuality } from '../../utils/quality.js';

const DEFAULT_PARTICLE_KEY = 'common-circle-4px';
const DEFAULT_SHAKE_INTENSITY = 0.002;

let cachedBaseClass = null;
let cachedPhaserRef = null;

/**
 * Create the BaseBoardScene class once Phaser is available.
 * @param {typeof Phaser} phaserLib
 * @returns {typeof Phaser.Scene}
 */
export function createBaseBoardScene(
    phaserLib = typeof window !== 'undefined' ? window.Phaser : null,
) {
    const PhaserRef = phaserLib;

    if (!PhaserRef?.Scene) {
        throw new Error(
            '[BaseBoardScene] Phaser is not available. Load Phaser before creating scenes.',
        );
    }

    if (cachedBaseClass && cachedPhaserRef === PhaserRef) {
        return cachedBaseClass;
    }

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
                board: null,
                piece: null,
                fx: null,
            };

            this.commonParticleKey = DEFAULT_PARTICLE_KEY;
            this.lastShakeTimestamp = 0;
            this.gameState = null;
            this.effectQuality = 'High';
            this.qualityConfig = getQualityConfig(this.effectQuality);
        }

        preload() {
            ensureCircleTexture(this, this.commonParticleKey, 4);
        }

        create() {
            this.createGraphicsLayers();
            this.configureCamera();
            this.registerResizeHandler();
        }

        update(time, delta) {
            // eslint-disable-line no-unused-vars
            if (!this.gameState) return;
            this.pieceGraphics?.clear();
            this.effectsGraphics?.clear();
            this.renderGameState();
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
         * Create default graphics layers.
         */
        createGraphicsLayers() {
            this.graphicsLayers.board = this.add.graphics();
            this.graphicsLayers.piece = this.add.graphics();
            this.graphicsLayers.fx = this.add.graphics();
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
         * Configure primary camera defaults.
         */
        configureCamera() {
            const camera = this.cameras?.main;
            if (!camera) return;

            camera.setRoundPixels(false);
            const { width, height } = this.getBoardDimensions();
            const { hiddenRows, blockSize } = this.boardConfig;

            // Set the camera bounds to the entire logical canvas size
            camera.setBounds(0, 0, width, height);

            // Center the camera on the *visible* portion of the board, not the entire canvas.
            // This is done by offsetting the center point by the height of the hidden rows.
            const visibleHeight = height - hiddenRows * blockSize;
            camera.centerOn(width / 2, visibleHeight / 2 + hiddenRows * blockSize);
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
            this.drawGrid();
            this.drawLockedPieces();
            if (this.gameState.currentPiece) {
                this.drawGhostPiece();
                this.drawCurrentPiece();
            }
        }

        drawGrid() {
            if (!this.boardGraphics) return;
            this.boardGraphics.clear();
            // No background fill, fully transparent
        }

        drawLockedPieces() {
            if (!this.gameState?.lockedPieces) return;

            this.gameState.lockedPieces.forEach((piece) => {
                const pieceColor = piece.color || '#808080';
                
                // Draw all blocks of the piece as solid fill first
                piece.shape.forEach((row, y) => {
                    row.forEach((cell, x) => {
                        if (cell > 0) {
                            const worldY = piece.y + y;
                            if (worldY >= this.hiddenRows) {
                                this.drawBlock(piece.x + x, worldY, pieceColor, 1.0, false, piece.shape, x, y);
                            }
                        }
                    });
                });
                
                // Draw outline around the entire piece
                this.drawPieceOutline(piece);
            });
        }

        drawGhostPiece() {
            const piece = this.gameState?.currentPiece;
            if (!piece) return;

            let ghostY = piece.y;
            while (this.isValidPosition(piece.x, ghostY + 1, piece.shape)) {
                ghostY++;
            }

            piece.shape.forEach((row, y) => {
                row.forEach((cell, x) => {
                    if (cell > 0) {
                        const worldX = piece.x + x;
                        const worldY = ghostY + y;

                        if (worldY >= this.hiddenRows) {
                            // Define the min and max brightness for the pulse
                            const minAlpha = 0.1; // How dim the pulse gets
                            const maxAlpha = 0.35; // How bright the pulse gets

                            // Get the current pulse value (0 to 1) for this block's position
                            const pulse = this._getPulseIntensity(worldX, worldY);

                            // Map the pulse value to your desired alpha range
                            const pulsatingAlpha = minAlpha + (maxAlpha - minAlpha) * pulse;

                            // Draw the block with the new pulsating alpha
                            this.drawBlock(worldX, worldY, '#FFFFFF', pulsatingAlpha, true);
                        }
                    }
                });
            });
        }

        drawCurrentPiece() {
            const piece = this.gameState?.currentPiece;
            if (!piece) return;

            // Draw all blocks of the piece as solid fill first
            piece.shape.forEach((row, y) => {
                row.forEach((cell, x) => {
                    if (cell > 0) {
                        const worldY = piece.y + y;
                        if (worldY >= this.hiddenRows) {
                            this.drawBlock(piece.x + x, worldY, piece.color, 1.0, false, piece.shape, x, y);
                        }
                    }
                });
            });
            
            // Draw outline around the entire piece
            const tempPiece = {
                ...piece,
                y: piece.y, // Already in world coordinates
                x: piece.x
            };
            this.drawPieceOutline(tempPiece);
        }

        drawBlock(x, y, color, alpha = 1.0, isGhost = false, shape = null, localX = 0, localY = 0) {
            // Use Math.round for pixel-perfect integer coordinates
            const px = Math.round(x * this.blockSize);
            const py = Math.round(y * this.blockSize);
            const size = this.blockSize;

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
                this.pieceGraphics.fillStyle(colorInt, alpha);
                this.pieceGraphics.fillRect(px, py, size, size);
                return;
            }

            // Draw the solid color fill for the block (no individual borders)
            this.pieceGraphics.fillStyle(colorInt, alpha);
            this.pieceGraphics.fillRect(px, py, size, size);
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
            
            // Draw crisp, thin black borders only on the outer edges of the piece
            this.pieceGraphics.lineStyle(0.25, 0x000000, 1.0);
            
            piece.shape.forEach((row, y) => {
                row.forEach((cell, x) => {
                    if (cell > 0) {
                        const worldX = piece.x + x;
                        const worldY = piece.y + y;
                        
                        if (worldY < this.hiddenRows) return;
                        
                        // Use Math.round for pixel-perfect integer coordinates
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

        isValidPosition(checkX, checkY, shape) {
            for (let row = 0; row < shape.length; row++) {
                for (let col = 0; col < shape[row].length; col++) {
                    if (shape[row][col] > 0) {
                        const newX = checkX + col;
                        const newY = checkY + row;

                        if (newX < 0 || newX >= this.cols || newY >= this.rows + this.hiddenRows) {
                            return false;
                        }

                        if (this.gameState?.lockedPieces) {
                            for (const locked of this.gameState.lockedPieces) {
                                for (let ly = 0; ly < locked.shape.length; ly++) {
                                    for (let lx = 0; lx < locked.shape[ly].length; lx++) {
                                        if (locked.shape[ly][lx] > 0) {
                                            if (locked.x + lx === newX && locked.y + ly === newY) {
                                                return false;
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            return true;
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
         * Remove listeners on shutdown.
         */
        shutdown() {
            if (this.scale) {
                this.scale.off('resize');
            }
        }

        /**
         * Sync scene with latest game state.
         * Child scenes can extend but should call super.syncFromGameState.
         * @param {Object} gameState
         */
        syncFromGameState(gameState) {
            this.gameState = gameState;
        }
    }

    cachedBaseClass = BaseBoardScene;
    cachedPhaserRef = PhaserRef;
    return BaseBoardScene;
}
