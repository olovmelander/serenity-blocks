/**
 * Single-Player Canvas Renderer
 * Pure canvas-based rendering for single-player mode
 * Based on FFA multiplayer canvas implementation
 */

import { COLS, ROWS, HIDDEN_ROWS } from '../../core/constants.js';
import { canPlacePiece } from '../../core/game.js';
import {
  calculateBlockSize,
  drawGrid,
  drawPiece,
  drawLockedPieces,
  calculateGhostY,
  clearCanvas,
  drawBlockStyled,
} from './canvas-drawing-utils.js';
import { TetrominoStyleManager } from '../tetromino-style-manager.js';

export class SinglePlayerCanvasRenderer {
  constructor(containerId) {
    this.containerId = containerId;
    this.container = null;
    this.canvas = null;
    this.ctx = null;
    this.blockSize = 30;
    this.resizeHandler = null;
    this.resizeTimeout = null;

    // Initialize Tetromino Style Manager for theme-based tetromino colors
    this.styleManager = new TetrominoStyleManager(
      window.themeManager,
      window.settingsManager
    );
    this.styleManager.init();

    console.log('🎨 Initializing SinglePlayerCanvasRenderer with theme-based tetrominos...');
    this.init();
  }
  
  /**
   * Initialize the renderer
   */
  init() {
    // Get container
    this.container = typeof this.containerId === 'string'
      ? document.getElementById(this.containerId)
      : this.containerId;
    
    if (!this.container) {
      console.error('❌ Container not found:', this.containerId);
      return;
    }
    
    // Create canvas
    this.createCanvas();
    
    // Setup resize handler
    this.setupResizeHandler();
    
    console.log('✅ SinglePlayerCanvasRenderer initialized');
  }
  
  /**
   * Create and configure the canvas
   * Based on multi-player-canvas-layout.js:662-718
   */
  createCanvas() {
    // Remove existing canvas if present
    if (this.canvas && this.canvas.parentNode) {
      this.canvas.parentNode.removeChild(this.canvas);
    }
    
    // Calculate optimal block size
    const size = this.calculateOptimalSize();
    this.blockSize = size.blockSize;
    
    // Create canvas element
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'single-player-game-canvas';
    this.canvas.width = size.width;
    this.canvas.height = size.height;
    
    // Apply styles for proper display
    this.canvas.style.display = 'block';
    this.canvas.style.imageRendering = 'pixelated';
    this.canvas.style.imageRendering = 'crisp-edges';
    this.canvas.style.margin = '0';
    this.canvas.style.padding = '0';
    
    // Get context
    this.ctx = this.canvas.getContext('2d');
    
    // Clear container and append canvas
    this.container.innerHTML = '';
    this.container.appendChild(this.canvas);
    
    console.log(`📐 Canvas created: ${size.width}x${size.height} (${this.blockSize}px blocks)`);
  }
  
  /**
   * Calculate optimal canvas size based on viewport
   * Based on multi-player-canvas-layout.js:678-706
   */
  calculateOptimalSize() {
    // Account for UI elements:
    // - Stats panel header: ~60px
    // - Next pieces preview: ~120px
    // - Container padding: ~50px (12px padding * 2 + borders)
    // - Main area padding: ~40px
    const UI_OVERHEAD_HEIGHT = 270;
    const availableHeight = window.innerHeight - UI_OVERHEAD_HEIGHT;
    
    // Account for sidebar (typically ~350px) plus margins
    const SIDEBAR_WIDTH = 400;
    const availableWidth = window.innerWidth - SIDEBAR_WIDTH;
    
    // Calculate block size (min 20px, max 60px per block)
    const blockSize = calculateBlockSize(availableWidth, availableHeight, COLS, ROWS, 20, 60);
    
    return {
      width: COLS * blockSize,
      height: ROWS * blockSize,
      blockSize: blockSize
    };
  }
  
  /**
   * Setup window resize handler
   * Based on multi-player-canvas-layout.js:499-505
   */
  setupResizeHandler() {
    this.resizeHandler = () => {
      clearTimeout(this.resizeTimeout);
      this.resizeTimeout = setTimeout(() => {
        console.log('🔄 Window resized, recalculating canvas...');
        this.createCanvas(); // Recreate with new size
      }, 250);
    };
    
    window.addEventListener('resize', this.resizeHandler);
  }
  
  /**
   * Draw a piece with theme-based styling
   * @param {Object} piece - Piece to draw
   * @param {boolean} isGhost - Whether this is a ghost piece
   */
  drawStyledPiece(piece, isGhost = false) {
    if (!piece || !piece.shape) return;

    piece.shape.forEach((row, localY) => {
      row.forEach((cell, localX) => {
        if (cell > 0) {
          const worldY = piece.y + localY;
          const x = (piece.x + localX) * this.blockSize;
          const y = (worldY - HIDDEN_ROWS) * this.blockSize;

          // Get themed style for this piece type
          const styleConfig = this.styleManager.getStyleForPiece(piece.type);

          // Use styled drawing
          drawBlockStyled(this.ctx, x, y, this.blockSize, styleConfig, isGhost);
        }
      });
    });
  }

  /**
   * Draw locked pieces with theme-based styling
   * @param {Array} lockedPieces - Array of locked pieces
   */
  drawStyledLockedPieces(lockedPieces) {
    if (!lockedPieces || lockedPieces.length === 0) return;

    lockedPieces.forEach(piece => {
      if (!piece.shape) return;

      piece.shape.forEach((row, localY) => {
        row.forEach((cell, localX) => {
          if (cell > 0) {
            const worldY = piece.y + localY;

            // Only draw visible area (below hidden rows)
            if (worldY >= HIDDEN_ROWS) {
              const x = (piece.x + localX) * this.blockSize;
              const y = (worldY - HIDDEN_ROWS) * this.blockSize;

              // Get themed style for this piece type
              const styleConfig = this.styleManager.getStyleForPiece(piece.type);

              // Use styled drawing
              drawBlockStyled(this.ctx, x, y, this.blockSize, styleConfig, false);
            }
          }
        });
      });
    });
  }

  /**
   * Main render function - draws the complete game state
   * @param {Object} gameState - Current game state
   */
  render(gameState) {
    if (!this.ctx || !this.canvas || !gameState) return;

    // Clear canvas
    clearCanvas(this.ctx, this.canvas.width, this.canvas.height);

    // Draw grid
    drawGrid(this.ctx, this.canvas.width, this.canvas.height, COLS, ROWS);

    // Draw locked pieces with theme-based styling
    if (gameState.lockedPieces && gameState.lockedPieces.length > 0) {
      this.drawStyledLockedPieces(gameState.lockedPieces);
    }

    // Draw current piece (with ghost piece)
    if (gameState.currentPiece) {
      // Draw ghost piece first (behind current piece)
      const ghostY = calculateGhostY(
        gameState.currentPiece,
        gameState.lockedPieces || [],
        (piece, x, y) => canPlacePiece(gameState, piece, x, y)
      );
      if (ghostY > gameState.currentPiece.y) {
        const ghostPiece = {
          ...gameState.currentPiece,
          y: ghostY
        };
        this.drawStyledPiece(ghostPiece, true);
      }

      // Draw current piece with theme-based styling
      this.drawStyledPiece(gameState.currentPiece, false);
    }
  }
  
  /**
   * Get current block size
   * @returns {number} Block size in pixels
   */
  getBlockSize() {
    return this.blockSize;
  }
  
  /**
   * Get canvas element
   * @returns {HTMLCanvasElement} Canvas element
   */
  getCanvas() {
    return this.canvas;
  }
  
  /**
   * Get canvas context
   * @returns {CanvasRenderingContext2D} Canvas context
   */
  getContext() {
    return this.ctx;
  }
  
  /**
   * Cleanup and destroy renderer
   */
  destroy() {
    // Cleanup style manager
    if (this.styleManager) {
      this.styleManager.destroy();
      this.styleManager = null;
    }

    // Remove resize listener
    if (this.resizeHandler) {
      window.removeEventListener('resize', this.resizeHandler);
      this.resizeHandler = null;
    }

    // Clear timeout
    if (this.resizeTimeout) {
      clearTimeout(this.resizeTimeout);
      this.resizeTimeout = null;
    }

    // Remove canvas
    if (this.canvas && this.canvas.parentNode) {
      this.canvas.parentNode.removeChild(this.canvas);
    }

    // Clear references
    this.canvas = null;
    this.ctx = null;
    this.container = null;

    console.log('🧹 SinglePlayerCanvasRenderer destroyed');
  }
}
