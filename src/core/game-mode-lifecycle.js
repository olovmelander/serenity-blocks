/**
 * Game Mode Lifecycle Manager
 * Ensures only one game mode runs at a time
 */

export const GAME_MODE = {
  NONE: 'none',
  SINGLE_PLAYER: 'single-player',
  LOCAL_MULTIPLAYER: 'local-multiplayer',
  ONLINE_MULTIPLAYER: 'online-multiplayer',
};

export class GameModeLifecycle {
  constructor(app) {
    this.app = app;
    this.currentMode = GAME_MODE.NONE;
    this.activeLoops = new Set();
    
    console.log('🔄 GameModeLifecycle initialized');
  }
  
  /**
   * Start a new game mode, stopping any currently active mode
   * @param {string} mode - Target game mode
   */
  async switchTo(mode) {
    console.log(`🔄 Switching from ${this.currentMode} → ${mode}`);
    
    // Stop current mode first
    await this.stopCurrentMode();
    
    // Start new mode
    await this.startMode(mode);
    
    this.currentMode = mode;
    console.log(`✅ Now in ${mode} mode`);
  }
  
  /**
   * Stop the currently active game mode
   */
  async stopCurrentMode() {
    if (this.currentMode === GAME_MODE.NONE) {
      return;
    }
    
    console.log(`🛑 Stopping ${this.currentMode}...`);
    
    switch (this.currentMode) {
      case GAME_MODE.SINGLE_PLAYER:
        await this.stopSinglePlayer();
        break;
        
      case GAME_MODE.LOCAL_MULTIPLAYER:
        await this.stopLocalMultiplayer();
        break;
        
      case GAME_MODE.ONLINE_MULTIPLAYER:
        await this.stopOnlineMultiplayer();
        break;
    }
    
    this.currentMode = GAME_MODE.NONE;
  }
  
  /**
   * Start a specific game mode
   * @param {string} mode - Game mode to start
   */
  async startMode(mode) {
    console.log(`▶️ Starting ${mode}...`);
    
    switch (mode) {
      case GAME_MODE.SINGLE_PLAYER:
        await this.startSinglePlayer();
        break;
        
      case GAME_MODE.LOCAL_MULTIPLAYER:
        await this.startLocalMultiplayer();
        break;
        
      case GAME_MODE.ONLINE_MULTIPLAYER:
        await this.startOnlineMultiplayer();
        break;
        
      case GAME_MODE.NONE:
        // Just cleanup, do nothing
        break;
    }
  }
  
  /**
   * Stop single-player mode
   */
  async stopSinglePlayer() {
    console.log('  🛑 Stopping single-player mode...');

    // Stop game loop (game logic updates)
    if (this.app.animationFrameId) {
      console.log('    ⏹️ Cancelling game loop (animationFrameId):', this.app.animationFrameId);
      cancelAnimationFrame(this.app.animationFrameId);
      this.app.animationFrameId = null;
    }

    // Stop render loop (canvas rendering)
    if (this.app.renderFrameId) {
      console.log('    ⏹️ Cancelling render loop (renderFrameId):', this.app.renderFrameId);
      cancelAnimationFrame(this.app.renderFrameId);
      this.app.renderFrameId = null;
    }

    // STOP Phaser board scene (not just pause - complete shutdown)
    if (this.app.phaserGame?.scene?.scenes?.length > 0) {
      const boardScene = this.app.phaserGame.scene.getScene('BoardScene');
      if (boardScene && boardScene.scene.isActive()) {
        console.log('    🛑 STOPPING Phaser board scene (complete shutdown)');
        boardScene.scene.stop(); // STOP instead of pause - completely shuts down scene
      }
    }

    // Hide single-player canvas
    if (this.app.singlePlayerCanvasRenderer) {
      console.log('    👁️ Hiding single-player canvas');
      const canvas = this.app.singlePlayerCanvasRenderer.getCanvas();
      if (canvas && canvas.parentElement) {
        canvas.parentElement.style.display = 'none';
      }
    }

    // Hide single-player UI
    const singlePlayerContainer = document.getElementById('single-player-container');
    if (singlePlayerContainer) {
      console.log('    👁️ Hiding single-player container');
      singlePlayerContainer.style.display = 'none';
    }

    console.log('  ✅ Single-player completely stopped');
  }
  
  /**
   * Stop local multiplayer mode
   */
  async stopLocalMultiplayer() {
    // Stop multiplayer game loop
    if (this.app.multiplayerState?.animationId) {
      console.log('  ⏹️ Cancelling local multiplayer animation frame');
      cancelAnimationFrame(this.app.multiplayerState.animationId);
      this.app.multiplayerState.animationId = null;
    }
    
    // Clear multiplayer state
    if (this.app.multiplayerState) {
      this.app.multiplayerState = null;
    }
    
    console.log('  ✅ Local multiplayer stopped');
  }
  
  /**
   * Stop online multiplayer mode
   */
  async stopOnlineMultiplayer() {
    // Stop FFA render loop
    if (this.app.multiPlayerCanvasLayout) {
      console.log('  ⏹️ Stopping FFA render loop');
      this.app.multiPlayerCanvasLayout.stopRenderLoop();
      this.app.multiPlayerCanvasLayout.hide();
    }
    
    // Hide multiplayer UI
    const multiplayerContainer = document.getElementById('multiplayer-container');
    if (multiplayerContainer) {
      console.log('  👁️ Hiding multiplayer container');
      multiplayerContainer.style.display = 'none';
    }
    
    // Stop FFA game state (but don't destroy - might want to resume)
    if (this.app.ffaGameState) {
      console.log('  ⏸️ Pausing FFA game state');
      // The FFA state manages its own loops internally
      // We just stop rendering to it
    }
    
    console.log('  ✅ Online multiplayer stopped');
  }
  
  /**
   * Start single-player mode
   */
  async startSinglePlayer() {
    console.log('  ▶️ Starting single-player mode...');

    // Show single-player UI
    const singlePlayerContainer = document.getElementById('single-player-container');
    if (singlePlayerContainer) {
      console.log('    👁️ Showing single-player container');
      singlePlayerContainer.style.display = 'flex';
    }

    // Show canvas
    if (this.app.singlePlayerCanvasRenderer) {
      const canvas = this.app.singlePlayerCanvasRenderer.getCanvas();
      if (canvas && canvas.parentElement) {
        console.log('    👁️ Showing single-player canvas');
        canvas.parentElement.style.display = '';
      }
    }

    // DO NOT start Phaser board scene or render loop here
    // These should only start when the user actually starts a game via startSinglePlayerGame()
    // Just prepare the UI and make it visible

    console.log('  ✅ Single-player mode ready (waiting for user to start game)');
  }
  
  /**
   * Start local multiplayer mode
   */
  async startLocalMultiplayer() {
    console.log('  ✅ Local multiplayer ready');
    // Game loop will be started by startGame()
  }
  
  /**
   * Start online multiplayer mode
   */
  async startOnlineMultiplayer() {
    // Show multiplayer UI
    const multiplayerContainer = document.getElementById('multiplayer-container');
    if (multiplayerContainer) {
      console.log('  👁️ Showing multiplayer container');
      multiplayerContainer.style.display = 'flex';
    }
    
    // Start FFA render loop (will be started when match begins)
    console.log('  ✅ Online multiplayer UI ready');
  }
  
  /**
   * Get current active mode
   * @returns {string} Current game mode
   */
  getCurrentMode() {
    return this.currentMode;
  }
  
  /**
   * Check if a specific mode is active
   * @param {string} mode - Mode to check
   * @returns {boolean}
   */
  isMode(mode) {
    return this.currentMode === mode;
  }
  
  /**
   * Cleanup all resources
   */
  destroy() {
    this.stopCurrentMode();
    this.activeLoops.clear();
    console.log('🧹 GameModeLifecycle destroyed');
  }
}

