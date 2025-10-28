/**
 * Multiplayer Effects Manager
 * 
 * Manages Phaser 4 visual effects overlay for FFA multiplayer main player board
 * - Particle systems for line clears
 * - Piece lock ripples
 * - Line clear flashes
 * - Combo popups
 * 
 * Uses hybrid rendering: Canvas 2D for board, Phaser for effects
 */

import Phaser from 'phaser';
import { COLS, ROWS, HIDDEN_ROWS } from '../../core/constants.js';
import { createBoardScene } from './board-scene.js';

export class MultiplayerEffectsManager {
  constructor(containerElement, canvasSize) {
    this.container = containerElement;
    this.canvasSize = canvasSize; // { width, height, blockSize }
    this.phaserGame = null;
    this.boardScene = null;
    this.phaserContainer = null;
    this.phaserCanvas = null;
    this.deadOverlay = null;
    this.gameState = null;
    this.pendingEffectQuality = null;

    console.log('🎨 Initializing MultiplayerEffectsManager with Phaser board', canvasSize);

    this.initPhaser();
  }

  /**
   * Initialize Phaser instance responsible for rendering the main FFA board.
   * Reuses the single-player board scene so visuals and effects stay in sync.
   */
  initPhaser() {
    if (!this.container) {
      console.error('❌ Container element not found for Phaser board');
      return;
    }

    // Reuse the same container class so existing CSS continues to apply.
    let phaserContainer = this.container.querySelector('.phaser-effects-container');
    if (!phaserContainer) {
      phaserContainer = document.createElement('div');
      phaserContainer.className = 'phaser-effects-container';
      this.container.appendChild(phaserContainer);
    }

    // Ensure predictable sizing + stacking (board renders underneath DOM overlays).
    // Use relative positioning - the parent container handles centering via flexbox
    phaserContainer.style.position = 'relative';
    phaserContainer.style.pointerEvents = 'auto';
    phaserContainer.style.zIndex = '5';
    phaserContainer.style.width = `${this.canvasSize.width}px`;
    phaserContainer.style.height = `${this.canvasSize.height}px`;
    phaserContainer.style.display = 'block';
    phaserContainer.style.margin = '0 auto';

    this.phaserContainer = phaserContainer;

    const BoardSceneClass = createBoardScene(Phaser);

    const config = {
      type: Phaser.WEBGL,
      width: this.canvasSize.width,
      height: this.canvasSize.height,
      parent: phaserContainer,
      transparent: true,
      scene: [BoardSceneClass],
      fps: {
        target: 60,
        forceSetTimeOut: false,
      },
      scale: {
        mode: Phaser.Scale.NONE,
        width: this.canvasSize.width,
        height: this.canvasSize.height,
        autoRound: true,
        autoCenter: Phaser.Scale.CENTER_BOTH,
      },
      render: {
        antialias: true,
        pixelArt: false,
      },
      backgroundColor: 'rgba(0, 0, 0, 0)',
    };

    this.phaserGame = new Phaser.Game(config);

    this.phaserGame.events.once('ready', () => {
      // BoardScene auto-start is disabled in the shared config; start it explicitly.
      this.phaserGame.scene.start('BoardScene');

      const scene = this.phaserGame.scene.getScene('BoardScene');
      if (!scene) {
        console.error('❌ Failed to acquire BoardScene for FFA board');
        return;
      }

      this.boardScene = scene;
      this.boardScene.attachGraphicsLayerAliases?.();

      // Match block sizing to the layout that provided the canvas dimensions.
      if (typeof this.boardScene.resize === 'function') {
        this.boardScene.resize(this.canvasSize.width, this.canvasSize.height);
      } else {
        // Fallback: update block size manually if resize hook is unavailable.
        const newBlockSize = Math.floor(this.canvasSize.width / COLS);
        this.boardScene.boardConfig.blockSize = newBlockSize;
        this.boardScene.blockSize = newBlockSize;
        this.boardScene.cols = COLS;
        this.boardScene.rows = ROWS;
        this.boardScene.hiddenRows = HIDDEN_ROWS;
        this.boardScene.recreateGraphicsLayers?.();
        this.boardScene.configureCamera?.();
      }

      // Apply effect quality once the scene exists.
      if (this.pendingEffectQuality) {
        this.setEffectQuality(this.pendingEffectQuality);
        this.pendingEffectQuality = null;
      }

      // Draw immediately if a game state is already queued.
      if (this.gameState) {
        this.boardScene.syncFromGameState(this.gameState);
      }

      // Cache the actual Phaser canvas for later styling/overlays.
      this.phaserCanvas = phaserContainer.querySelector('canvas');
      if (this.phaserCanvas) {
        this.phaserCanvas.style.width = `${this.canvasSize.width}px`;
        this.phaserCanvas.style.height = `${this.canvasSize.height}px`;
        this.phaserCanvas.style.display = 'block';
        this.phaserCanvas.style.pointerEvents = 'auto';
        this.phaserCanvas.style.imageRendering = 'pixelated';
      }

      console.log('✅ Phaser board initialized for FFA main player', {
        width: this.canvasSize.width,
        height: this.canvasSize.height,
        blockSize: this.boardScene?.blockSize,
      });
    });
  }

  /**
   * Update game state for effects sync
   */
  updateGameState(gameState) {
    this.gameState = gameState;
    
    if (this.boardScene && this.boardScene.syncFromGameState) {
      this.boardScene.syncFromGameState(gameState);
    } else {
      console.log('ℹ️ BoardScene not ready yet; queued game state for Phaser board');
    }
  }
  
  /**
   * Trigger line clear flash effect
   * DELEGATED to SharedEffects
   */
  triggerLineClearFlash(clearedRows) {
    if (!this.boardScene?.effects || !clearedRows || clearedRows.length === 0) return;

    this.boardScene.effects.triggerLineClearFlash(clearedRows);
  }

  /**
   * Create piece lock ripple effect
   * DELEGATED to SharedEffects
   */
  createPieceLockRipple(piece) {
    if (!this.boardScene?.effects || !piece) return;

    this.boardScene.effects.createPieceLockRipple(piece);
  }

  /**
   * Show combo popup
   * DELEGATED to SharedEffects
   */
  showComboPopup(comboCount) {
    if (!this.boardScene?.effects || !comboCount) return;

    this.boardScene.effects.showComboPopup(comboCount);
  }

  /**
   * Play line clear impact effect (camera shake + particles)
   * DELEGATED to SharedEffects
   */
  playLineClearImpact(lineCount) {
    if (!this.boardScene?.effects || !lineCount) return;

    this.boardScene.effects.playLineClearImpact(lineCount);
  }
  
  /**
   * Set effect quality level
   */
  setEffectQuality(quality) {
    if (!this.boardScene || !this.boardScene.setEffectQuality) {
      this.pendingEffectQuality = quality;
      return;
    }

    this.boardScene.setEffectQuality(quality);
    console.log(`🎨 Effects quality set to: ${quality}`);
  }
  
  /**
   * Resize Phaser board when layout changes.
   */
  resize(newCanvasSize) {
    this.canvasSize = newCanvasSize;
    
    if (this.phaserGame && this.phaserGame.scale) {
      this.phaserGame.scale.resize(newCanvasSize.width, newCanvasSize.height);
      console.log(`📐 Phaser board resized to ${newCanvasSize.width}x${newCanvasSize.height}`);
    }
    
    if (this.phaserContainer) {
      this.phaserContainer.style.width = `${newCanvasSize.width}px`;
      this.phaserContainer.style.height = `${newCanvasSize.height}px`;
    }

    if (this.phaserCanvas) {
      this.phaserCanvas.style.width = `${newCanvasSize.width}px`;
      this.phaserCanvas.style.height = `${newCanvasSize.height}px`;
    }

    if (this.boardScene) {
      if (typeof this.boardScene.resize === 'function') {
        this.boardScene.resize(newCanvasSize.width, newCanvasSize.height);
      } else {
        const newBlockSize = Math.floor(newCanvasSize.width / COLS);
        this.boardScene.boardConfig.blockSize = newBlockSize;
        this.boardScene.blockSize = newBlockSize;
        this.boardScene.cols = COLS;
        this.boardScene.rows = ROWS;
        this.boardScene.hiddenRows = HIDDEN_ROWS;
        this.boardScene.recreateGraphicsLayers?.();
        this.boardScene.configureCamera?.();
      }
    }
  }

  /**
   * Retrieve the Phaser canvas element (used for DOM-based overlays).
   */
  getCanvasElement() {
    return this.phaserCanvas;
  }

  /**
   * Expose the Phaser container element so callers can layer DOM nodes.
   */
  getContainerElement() {
    return this.phaserContainer;
  }

  /**
   * Apply or clear the death overlay on the Phaser board.
   */
  setDeadState(isDead) {
    if (!this.phaserContainer) return;

    if (!isDead) {
      this.phaserContainer.style.outline = '';
      this.phaserCanvas && (this.phaserCanvas.style.filter = 'none');
      if (this.deadOverlay) {
        this.deadOverlay.remove();
        this.deadOverlay = null;
      }
      return;
    }

    if (this.phaserCanvas) {
      this.phaserCanvas.style.filter = 'grayscale(100%) brightness(0.4)';
    }

    this.phaserContainer.style.outline = '3px solid #ff0000';

    if (!this.deadOverlay) {
      const overlay = document.createElement('div');
      overlay.className = 'ffa-main-dead-overlay';
      overlay.style.position = 'absolute';
      overlay.style.top = '0';
      overlay.style.left = '0';
      overlay.style.right = '0';
      overlay.style.bottom = '0';
      overlay.style.display = 'flex';
      overlay.style.flexDirection = 'column';
      overlay.style.alignItems = 'center';
      overlay.style.justifyContent = 'center';
      overlay.style.background = 'rgba(0, 0, 0, 0.55)';
      overlay.style.color = '#ff5555';
      overlay.style.fontFamily = 'Orbitron, sans-serif';
      overlay.style.pointerEvents = 'none';
      overlay.style.zIndex = '20';
      overlay.innerHTML = `
        <div style="font-size: 48px; margin-bottom: 8px;">💀</div>
        <div style="font-size: 20px; letter-spacing: 4px;">DEAD</div>
      `;

      this.phaserContainer.appendChild(overlay);
      this.deadOverlay = overlay;
    }
  }
  
  /**
   * Clean up and destroy
   */
  destroy() {
    console.log('🧹 Destroying MultiplayerEffectsManager');

    // Cleanup SharedEffects
    if (this.boardScene?.effects) {
      this.boardScene.effects.cleanup();
      this.boardScene.effects = null;
    }

    if (this.phaserGame) {
      this.phaserGame.destroy(true);
      this.phaserGame = null;
    }

    this.boardScene = null;
    this.gameState = null;
    this.phaserCanvas = null;
    this.pendingEffectQuality = null;

    if (this.deadOverlay) {
      this.deadOverlay.remove();
      this.deadOverlay = null;
    }

    if (this.phaserContainer) {
      this.phaserContainer.remove();
      this.phaserContainer = null;
    }
  }
}
