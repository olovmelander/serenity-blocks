import { COLS, ROWS, HIDDEN_ROWS, BLOCK_SIZE } from '../../core/constants.js';
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
export function createBaseBoardScene(phaserLib = typeof window !== 'undefined' ? window.Phaser : null) {
    const PhaserRef = phaserLib;

    if (!PhaserRef?.Scene) {
        throw new Error('[BaseBoardScene] Phaser is not available. Load Phaser before creating scenes.');
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
            const resolvedKey = key ?? `BaseBoardScene-${PhaserRef.Utils?.String?.UUID ? PhaserRef.Utils.String.UUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`}`;
            super(resolvedKey);

            this.boardConfig = {
                cols: boardConfig.cols ?? COLS,
                rows: boardConfig.rows ?? ROWS,
                hiddenRows: boardConfig.hiddenRows ?? HIDDEN_ROWS,
                blockSize: boardConfig.blockSize ?? BLOCK_SIZE
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
                fx: null
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

        update(time, delta) { // eslint-disable-line no-unused-vars
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
            const { cols, rows, blockSize } = this.boardConfig;
            return {
                width: cols * blockSize,
                height: rows * blockSize
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
            camera.setBounds(0, 0, width, height);
            camera.centerOn(width / 2, height / 2);
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
            if (!this.scale) return;
            this.scale.on('resize', this.handleResize, this);
            this.handleResize(this.scale.gameSize, this.scale.baseSize, this.scale.displaySize);
        }

        /**
         * Default resize handler. Scenes can override if they need custom logic.
         * @param {{width:number, height:number}} gameSize
         * @param {{width:number, height:number}} displaySize
         */
        handleResize(gameSize, baseSize, displaySize) {
            const camera = this.cameras?.main;
            if (!camera) return;

            const { width, height } = this.getBoardDimensions();
            const cssWidth = displaySize?.width ?? gameSize.width;
            const cssHeight = displaySize?.height ?? gameSize.height;
            const zoom = Math.min(cssWidth / width, cssHeight / height);

            camera.setZoom(zoom);
            camera.centerOn(width / 2, height / 2);
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

            const lineColor = 0x1a1a2e;
            const lineAlpha = 0.3;
            const lineWidth = 1;
            this.boardGraphics.lineStyle(lineWidth, lineColor, lineAlpha);

            const height = this.rows * this.blockSize;

            for (let x = 0; x <= this.cols; x++) {
                this.boardGraphics.beginPath();
                this.boardGraphics.moveTo(x * this.blockSize, 0);
                this.boardGraphics.lineTo(x * this.blockSize, height);
                this.boardGraphics.strokePath();
            }

            for (let y = 0; y <= this.rows; y++) {
                this.boardGraphics.beginPath();
                this.boardGraphics.moveTo(0, y * this.blockSize);
                this.boardGraphics.lineTo(this.cols * this.blockSize, y * this.blockSize);
                this.boardGraphics.strokePath();
            }
        }

        drawLockedPieces() {
            if (!this.gameState?.lockedPieces) return;

            this.gameState.lockedPieces.forEach(piece => {
                let pieceColor = piece.color || '#808080';

                piece.shape.forEach((row, y) => {
                    row.forEach((cell, x) => {
                        if (cell > 0) {
                            const worldY = piece.y + y;
                            if (worldY >= this.hiddenRows) {
                                this.drawBlock(
                                    piece.x + x,
                                    worldY,
                                    pieceColor,
                                    1.0
                                );
                            }
                        }
                    });
                });
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
                        const worldY = ghostY + y;
                        if (worldY >= this.hiddenRows) {
                            this.drawBlock(
                                piece.x + x,
                                worldY,
                                piece.color,
                                0.2,
                                true
                            );
                        }
                    }
                });
            });
        }

        drawCurrentPiece() {
            const piece = this.gameState?.currentPiece;
            if (!piece) return;

            piece.shape.forEach((row, y) => {
                row.forEach((cell, x) => {
                    if (cell > 0) {
                        const worldY = piece.y + y;
                        if (worldY >= this.hiddenRows) {
                            this.drawBlock(
                                piece.x + x,
                                worldY,
                                piece.color,
                                1.0
                            );
                        }
                    }
                });
            });
        }

        drawBlock(x, y, color, alpha = 1.0, isGhost = false) {
            const px = x * this.blockSize;
            const py = (y - this.hiddenRows) * this.blockSize;
            const size = this.blockSize;

            let colorInt = 0x808080;
            if (color && typeof color === 'string') {
                const parsed = parseInt(color.replace('#', ''), 16);
                if (!Number.isNaN(parsed)) {
                    colorInt = parsed;
                }
            }

            if (isGhost) {
                this.pieceGraphics.lineStyle(2, colorInt, alpha);
                this.pieceGraphics.beginPath();
                this.pieceGraphics.strokeRect(px + 1, py + 1, size - 2, size - 2);
                this.pieceGraphics.closePath();
                return;
            }

            this.pieceGraphics.fillStyle(colorInt, alpha);
            this.pieceGraphics.fillRect(px, py, size, size);

            const highlightColor = this.lightenColor(colorInt, 0.2);
            const shadowColor = this.darkenColor(colorInt, 0.2);

            this.pieceGraphics.fillStyle(highlightColor, alpha * 0.5);
            this.pieceGraphics.fillRect(px, py, size, 2);
            this.pieceGraphics.fillRect(px, py, 2, size);

            this.pieceGraphics.fillStyle(shadowColor, alpha * 0.5);
            this.pieceGraphics.fillRect(px, py + size - 2, size, 2);
            this.pieceGraphics.fillRect(px + size - 2, py, 2, size);

            this.pieceGraphics.lineStyle(1, 0x000000, alpha * 0.3);
            this.pieceGraphics.beginPath();
            this.pieceGraphics.strokeRect(px, py, size, size);
            this.pieceGraphics.closePath();
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
                this.scale.off('resize', this.handleResize, this);
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
