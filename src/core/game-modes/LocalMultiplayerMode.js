import Phaser from 'phaser';
import { BaseGameMode } from './BaseGameMode.js';
import { MultiplayerGameState } from '../multiplayer.js';
import { GAME_MODES, COLS, ROWS, BLOCK_SIZE } from '../constants.js';
import { spawnPiece, fillBag, softDrop } from '../game.js';
import { seededRandom } from '../../utils/helpers.js';
import { drawNextPieces } from '../../rendering/draw.js';

/**
 * LocalMultiplayerMode - Local 2-player competitive mode
 *
 * Manages:
 * - MultiplayerGameState with two player instances
 * - Two Phaser board scenes (side-by-side)
 * - Multiplayer game loop with garbage system
 * - Shared RNG seed for fairness
 */
export class LocalMultiplayerMode extends BaseGameMode {
    constructor(dependencies) {
        super(dependencies);

        // Multiplayer specific state
        this.multiplayerState = null;
        this.animationFrameId = null;
        this.boardScenes = [];
        this.cleanupHandlers = [];

        // Separate Phaser game instances for each player
        this.p1PhaserGame = null;
        this.p2PhaserGame = null;
        this.p1BoardScene = null;
        this.p2BoardScene = null;

        // Canvas references for next pieces
        this.p1NextCanvases = [];
        this.p2NextCanvases = [];
        
        // Round tracking (frags)
        this.roundsToWin = 7; // First to 7 frags
        this.roundWins = {
            player1: 0,
            player2: 0
        };
        
        // Cumulative match stats (preserved across rounds)
        this.matchStats = {
            player1: { score: 0, lines: 0 },
            player2: { score: 0, lines: 0 }
        };
    }

    getModeId() {
        return GAME_MODES.LOCAL_MULTIPLAYER;
    }

    getDisplayName() {
        return 'Local Multiplayer (2P)';
    }

    /**
     * Called when local multiplayer mode is selected
     */
    async onActivate() {
        await super.onActivate();

        console.log('[LocalMultiplayer] Activating local multiplayer mode...');

        // Get next piece canvas references (main boards are rendered by Phaser)
        this.p1NextCanvases = Array.from({ length: 3 }, (_, i) => document.getElementById(`p1-next-${i}`));
        this.p2NextCanvases = Array.from({ length: 3 }, (_, i) => document.getElementById(`p2-next-${i}`));

        if (!this.p1NextCanvases[0] || !this.p2NextCanvases[0]) {
            throw new Error('Multiplayer next piece canvases not found');
        }

        // Hide single player container
        const singlePlayerContainer = document.getElementById('single-player-container');
        if (singlePlayerContainer) {
            singlePlayerContainer.style.display = 'none';
        }

        // Show multiplayer container
        const multiplayerContainer = document.getElementById('multiplayer-container');
        if (multiplayerContainer) {
            multiplayerContainer.style.display = 'block';
        }

        // Create separate Phaser game instances for each player
        await this._createSeparatePhaserGames();

        // Pause single player scene
        this._pauseSinglePlayerScene();

        console.log('[LocalMultiplayer] Mode activated, ready to start');
    }

    /**
     * Called when user clicks "Start Game"
     */
    async onStart() {
        await super.onStart();

        console.log('[LocalMultiplayer] Starting game...');
        
        // Hide start modal immediately
        this.deps.modalManager.hideAll();

        // Reset match stats for new game
        this.matchStats = {
            player1: { score: 0, lines: 0 },
            player2: { score: 0, lines: 0 }
        };
        this.roundWins = {
            player1: 0,
            player2: 0
        };

        // Initialize multiplayer state (lazy initialization)
        this.multiplayerState = new MultiplayerGameState();
        this.multiplayerState.reset();
        this.multiplayerState.isPaused = true;

        // Activate Phaser multiplayer UI
        this._activatePhaserMultiplayerUI();

        // Get references to the board scenes (created in onActivate)
        if (!this.p1BoardScene || !this.p2BoardScene) {
            throw new Error('Board scenes not initialized. Call onActivate first.');
        }
        
        // Store scenes in array for compatibility with existing sync code
        this.boardScenes = [this.p1BoardScene, this.p2BoardScene];
        console.log('[LocalMultiplayer] Using separate board scenes:', {
            p1: this.p1BoardScene?.scene?.key,
            p2: this.p2BoardScene?.scene?.key
        });

        // Create shared RNG seed for fairness
        const sharedSeed = Math.floor(Math.random() * 1000000) || 1;
        this.multiplayerState.sharedPieceSeed = sharedSeed;
        this.multiplayerState.player1.randomGenerator = seededRandom(sharedSeed);
        this.multiplayerState.player2.randomGenerator = seededRandom(sharedSeed);
        console.log(`[LocalMultiplayer] Shared seed: ${sharedSeed}`);

        // Fill piece bags for both players
        fillBag(this.multiplayerState.player1.nextPieces, this.multiplayerState.player1.randomGenerator);
        fillBag(this.multiplayerState.player2.nextPieces, this.multiplayerState.player2.randomGenerator);

        // Draw initial next pieces
        drawNextPieces(this.p1NextCanvases, this.multiplayerState.player1.nextPieces);
        drawNextPieces(this.p2NextCanvases, this.multiplayerState.player2.nextPieces);

        // Update stats display
        this._updateMultiplayerStats();

        // Show countdown
        await this._showCountdown();

        // Spawn first pieces for both players
        this.multiplayerState.lastTime = performance.now();

        spawnPiece(
            this.multiplayerState.player1,
            () => {
                drawNextPieces(this.p1NextCanvases, this.multiplayerState.player1.nextPieces);
                this._syncBoardScenes();
            },
            () => this._handleGameOver(1)
        );

        spawnPiece(
            this.multiplayerState.player2,
            () => {
                drawNextPieces(this.p2NextCanvases, this.multiplayerState.player2.nextPieces);
                this._syncBoardScenes();
            },
            () => this._handleGameOver(2)
        );

        this._syncBoardScenes();

        // Start game loop
        this.multiplayerState.isPaused = false;
        this.multiplayerState.lastTime = performance.now();
        this._startGameLoop();

        console.log('[LocalMultiplayer] Game started!');
    }

    /**
     * Called when game is paused
     */
    onPause() {
        super.onPause();

        if (this.multiplayerState) {
            this.multiplayerState.isPaused = true;
        }
    }

    /**
     * Called when game is resumed
     */
    onResume() {
        super.onResume();

        if (this.multiplayerState) {
            this.multiplayerState.isPaused = false;
            this.multiplayerState.lastTime = performance.now();
        }
    }

    /**
     * Called when game ends
     */
    async onStop() {
        await super.onStop();

        console.log('[LocalMultiplayer] Stopping game...');

        // Stop game loop
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }

        if (this.multiplayerState?.animationId) {
            cancelAnimationFrame(this.multiplayerState.animationId);
            this.multiplayerState.animationId = null;
        }

        // Mark game as over
        if (this.multiplayerState) {
            this.multiplayerState.isGameOver = true;
        }
    }

    /**
     * Called when mode is deselected
     */
    async onDeactivate() {
        await super.onDeactivate();

        console.log('[LocalMultiplayer] Deactivating...');

        // Deactivate Phaser multiplayer UI
        this._deactivatePhaserMultiplayerUI();

        // Destroy separate Phaser game instances
        if (this.p1PhaserGame) {
            this.p1PhaserGame.destroy(true);
            this.p1PhaserGame = null;
            this.p1BoardScene = null;
        }
        if (this.p2PhaserGame) {
            this.p2PhaserGame.destroy(true);
            this.p2PhaserGame = null;
            this.p2BoardScene = null;
        }

        // Resume single player scene
        this._resumeSinglePlayerScene();

        // Clean up state
        this.multiplayerState = null;
        this.boardScenes = [];

        // Clean up event listeners
        this._cleanupEventListeners(this.cleanupHandlers);
    }

    /**
     * Handle window resize
     */
    onResize() {
        const singleBoardWidth = COLS * BLOCK_SIZE;
        const multiBoardWidth = singleBoardWidth * 2 + this.boardGap;
        const multiBoardHeight = ROWS * BLOCK_SIZE;
        this._resizePhaserGame(multiBoardWidth, multiBoardHeight, true);
    }

    /**
     * Get current state
     */
    getState() {
        return {
            ...super.getState(),
            player1: {
                score: this.multiplayerState?.player1.score || 0,
                lines: this.multiplayerState?.player1.lines || 0,
                level: this.multiplayerState?.player1.level || 1,
            },
            player2: {
                score: this.multiplayerState?.player2.score || 0,
                lines: this.multiplayerState?.player2.lines || 0,
                level: this.multiplayerState?.player2.level || 1,
            },
        };
    }

    // ===== Private Methods =====

    /**
     * Start the multiplayer game loop
     * @private
     */
    _startGameLoop() {
        const loop = (currentTime) => {
            if (!this.isRunning || this.multiplayerState.isGameOver) {
                return;
            }

            if (this.multiplayerState.isPaused) {
                this.animationFrameId = requestAnimationFrame(loop);
                return;
            }

            const delta = currentTime - this.multiplayerState.lastTime;
            this.multiplayerState.lastTime = currentTime;

            // Update both players using the core game physics
            [1, 2].forEach((playerNum) => {
                const playerState = playerNum === 1
                    ? this.multiplayerState.player1
                    : this.multiplayerState.player2;

                if (!playerState.isProcessingPhysics && playerState.currentPiece) {
                    playerState.dropCounter += delta;
                    if (playerState.dropCounter > playerState.dropInterval) {
                        // Use proper multiplayer callbacks (from main.js) to handle garbage and spawning
                        const callbacks = this.deps.getMultiplayerPhysicsCallbacks?.(playerNum) 
                            || this._getPhysicsCallbacks();
                        softDrop(
                            playerState,
                            () => this.deps.soundManager.sfxPlayer.playDrop(),
                            callbacks
                        );
                    }
                }
            });

            // Update stats display
            this._updateMultiplayerStats();

            // Sync board scenes
            this._syncBoardScenes();

            // Continue loop
            this.animationFrameId = requestAnimationFrame(loop);
        };

        this.animationFrameId = requestAnimationFrame(loop);
    }

    /**
     * Get physics callbacks for sound effects
     * @private
     */
    _getPhysicsCallbacks() {
        return {
            onMove: () => this.deps.soundManager.sfxPlayer.playMove(),
            onRotate: () => this.deps.soundManager.sfxPlayer.playRotate(),
            onLineClear: (lines) => {
                if (lines === 4) {
                    this.deps.soundManager.sfxPlayer.playTetris();
                } else {
                    this.deps.soundManager.sfxPlayer.playLineClear();
                }
            },
            onLevelUp: () => this.deps.soundManager.sfxPlayer.playLevelUp(),
            onHardDrop: () => this.deps.soundManager.sfxPlayer.playHardDrop(),
            onGarbageReceived: () => this.deps.soundManager.sfxPlayer.playGarbageReceived?.(),
            onDrop: () => this.deps.soundManager.sfxPlayer.playDrop(),
        };
    }

    /**
     * Update multiplayer stats display
     * @private
     */
    _updateMultiplayerStats() {
        if (!this.multiplayerState) {
            console.warn('[LocalMultiplayer] Cannot update stats: multiplayerState is null');
            return;
        }

        // Calculate cumulative scores (match total + current round)
        const p1TotalScore = this.matchStats.player1.score + this.multiplayerState.player1.score;
        const p1TotalLines = this.matchStats.player1.lines + this.multiplayerState.player1.lines;
        const p2TotalScore = this.matchStats.player2.score + this.multiplayerState.player2.score;
        const p2TotalLines = this.matchStats.player2.lines + this.multiplayerState.player2.lines;

        // Update Player 1 stats
        const p1Frags = document.getElementById('p1-frags');
        const p1Score = document.getElementById('p1-score');
        const p1Lines = document.getElementById('p1-lines');
        const p1Level = document.getElementById('p1-level');
        const p1Garbage = document.getElementById('p1-garbage');
        
        if (p1Frags) p1Frags.textContent = this.roundWins.player1;
        if (p1Score) p1Score.textContent = p1TotalScore;
        if (p1Lines) p1Lines.textContent = p1TotalLines;
        if (p1Level) p1Level.textContent = this.multiplayerState.player1.level;
        if (p1Garbage) p1Garbage.textContent = this.multiplayerState.getGarbageQueue(1).getTotalLines();

        // Update Player 2 stats
        const p2Frags = document.getElementById('p2-frags');
        const p2Score = document.getElementById('p2-score');
        const p2Lines = document.getElementById('p2-lines');
        const p2Level = document.getElementById('p2-level');
        const p2Garbage = document.getElementById('p2-garbage');
        
        if (p2Frags) p2Frags.textContent = this.roundWins.player2;
        if (p2Score) p2Score.textContent = p2TotalScore;
        if (p2Lines) p2Lines.textContent = p2TotalLines;
        if (p2Level) p2Level.textContent = this.multiplayerState.player2.level;
        if (p2Garbage) p2Garbage.textContent = this.multiplayerState.getGarbageQueue(2).getTotalLines();
    }

    /**
     * Sync board scenes with game state
     * @private
     */
    _syncBoardScenes() {
        if (!this.multiplayerState) {
            console.warn('[LocalMultiplayer] Cannot sync scenes: multiplayerState is null');
            return;
        }

        this.boardScenes.forEach((scene, index) => {
            const playerState = index === 0 ? this.multiplayerState.player1 : this.multiplayerState.player2;
            const playerNum = index + 1;
            
            if (scene && scene.syncFromGameState) {
                scene.syncFromGameState(playerState);
            } else {
                console.warn(`[LocalMultiplayer] Scene ${index} cannot sync:`, { 
                    hasScene: !!scene, 
                    hasSyncMethod: scene ? !!scene.syncFromGameState : false 
                });
            }
        });
    }

    /**
     * Handle game over for a player
     * @private
     */
    async _handleGameOver(playerNumber) {
        console.log(`[LocalMultiplayer] Player ${playerNumber} lost!`);

        await this.onStop();

        const winner = playerNumber === 1 ? 2 : 1;
        const winnerState = winner === 1 ? this.multiplayerState.player1 : this.multiplayerState.player2;

        // Show winner modal
        window.dispatchEvent(new CustomEvent('multiplayerGameOver', {
            detail: {
                winner,
                winnerScore: winnerState.score,
                winnerLines: winnerState.lines,
            }
        }));

        this.deps.modalManager.show('gameOver');
    }

    /**
     * Show countdown before game starts
     * @private
     */
    async _showCountdown() {
        console.log('[LocalMultiplayer] Starting countdown...');
        return new Promise((resolve) => {
            let count = 3;
            
            // Create overlay background
            const overlay = document.createElement('div');
            overlay.id = 'countdown-overlay';
            overlay.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.85);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 99999;
                pointer-events: none;
            `;
            
            const countdownElement = document.createElement('div');
            countdownElement.id = 'countdown-text';
            countdownElement.style.cssText = `
                font-family: Arial, sans-serif;
                font-size: 150px;
                font-weight: 900;
                color: #10b981;
                text-shadow: 
                    0 0 20px rgba(16, 185, 129, 1),
                    0 0 40px rgba(16, 185, 129, 0.8),
                    0 0 60px rgba(16, 185, 129, 0.6),
                    0 0 80px rgba(16, 185, 129, 0.4);
                line-height: 1;
                user-select: none;
            `;
            
            overlay.appendChild(countdownElement);
            document.body.appendChild(overlay);
            
            console.log('[LocalMultiplayer] Countdown overlay created');

            const countdown = () => {
                if (count > 0) {
                    console.log(`[LocalMultiplayer] Countdown: ${count}`);
                    countdownElement.textContent = count;
                    countdownElement.style.opacity = '1';
                    countdownElement.style.transform = 'scale(1)';
                    
                    this.deps.soundManager.sfxPlayer.playMove?.();
                    count--;
                    setTimeout(countdown, 1000);
                } else {
                    console.log('[LocalMultiplayer] Countdown: GO!');
                    countdownElement.textContent = 'GO!';
                    countdownElement.style.color = '#f59e0b';
                    countdownElement.style.textShadow = `
                        0 0 20px rgba(245, 158, 11, 1),
                        0 0 40px rgba(245, 158, 11, 0.8),
                        0 0 60px rgba(245, 158, 11, 0.6),
                        0 0 80px rgba(245, 158, 11, 0.4)
                    `;
                    countdownElement.style.opacity = '1';
                    countdownElement.style.transform = 'scale(1)';
                    
                    this.deps.soundManager.sfxPlayer.playDrop?.();
                    setTimeout(() => {
                        console.log('[LocalMultiplayer] Countdown complete, removing overlay');
                        overlay.style.transition = 'opacity 0.3s';
                        overlay.style.opacity = '0';
                        setTimeout(() => {
                            overlay.remove();
                            resolve();
                        }, 300);
                    }, 700);
                }
            };

            // Start countdown after a brief delay to ensure overlay is rendered
            setTimeout(countdown, 100);
        });
    }

    /**
     * Ensure multiplayer board scenes exist
     * @private
     */
    async _ensureMultiplayerBoardScenes() {
        const phaserGame = this.deps.phaserGame;
        const MultiplayerBoardSceneClass = this.deps.phaserGame?.MultiplayerBoardSceneClass;

        if (!phaserGame || !MultiplayerBoardSceneClass) {
            throw new Error('Phaser game or MultiplayerBoardScene class not available');
        }

        // Check if scenes already exist
        let scene1 = phaserGame.scene?.getScene('BoardPanel1');
        let scene2 = phaserGame.scene?.getScene('BoardPanel2');

        // If scenes don't exist, create them
        if (!scene1 || !scene2) {
            console.log('[LocalMultiplayer] Creating board panel scenes...');
            
            // Calculate viewport dimensions
            const singleBoardWidth = COLS * BLOCK_SIZE;
            const boardHeight = ROWS * BLOCK_SIZE;

            // Player 1 viewport (left side)
            const player1Viewport = {
                x: 0,
                y: 0,
                width: singleBoardWidth,
                height: boardHeight
            };

            // Player 2 viewport (right side, with gap)
            const player2Viewport = {
                x: singleBoardWidth + this.boardGap,
                y: 0,
                width: singleBoardWidth,
                height: boardHeight
            };

            // Create scene instances with unique keys
            // We MUST pass instances because Phaser doesn't support unique keys when passing CLASS
            const scene1Instance = new MultiplayerBoardSceneClass('BoardPanel1');
            const scene2Instance = new MultiplayerBoardSceneClass('BoardPanel2');
            
            // Add scenes with their instances
            phaserGame.scene.add('BoardPanel1', scene1Instance, false);
            phaserGame.scene.add('BoardPanel2', scene2Instance, false);
            
            // Start them manually with init data
            phaserGame.scene.start('BoardPanel1', {
                playerId: 1,
                viewport: player1Viewport,
                playerLabel: 'PLAYER 1',
                getPendingGarbage: (state) => state?.pendingGarbage || 0
            });
            
            phaserGame.scene.start('BoardPanel2', {
                playerId: 2,
                viewport: player2Viewport,
                playerLabel: 'PLAYER 2',
                getPendingGarbage: (state) => state?.pendingGarbage || 0
            });

            // Wait for scenes to initialize
            await new Promise((resolve) => setTimeout(resolve, 150));

            // Get scene references
            scene1 = phaserGame.scene?.getScene('BoardPanel1');
            scene2 = phaserGame.scene?.getScene('BoardPanel2');
        } else {
            // Scenes already exist, restart them with fresh data
            console.log('[LocalMultiplayer] Reusing existing board panel scenes...');
            
            // Calculate viewport dimensions
            const singleBoardWidth = COLS * BLOCK_SIZE;
            const boardHeight = ROWS * BLOCK_SIZE;

            // Player 1 viewport (left side)
            const player1Viewport = {
                x: 0,
                y: 0,
                width: singleBoardWidth,
                height: boardHeight
            };

            // Player 2 viewport (right side, with gap)
            const player2Viewport = {
                x: singleBoardWidth + this.boardGap,
                y: 0,
                width: singleBoardWidth,
                height: boardHeight
            };

            // Restart scenes - stop them first, then start with new data
            phaserGame.scene.stop('BoardPanel1');
            phaserGame.scene.stop('BoardPanel2');
            
            // Start both scenes - they should run in parallel
            phaserGame.scene.start('BoardPanel1', {
                playerId: 1,
                viewport: player1Viewport,
                playerLabel: 'PLAYER 1',
                getPendingGarbage: (state) => state?.pendingGarbage || 0
            });

            phaserGame.scene.start('BoardPanel2', {
                playerId: 2,
                viewport: player2Viewport,
                playerLabel: 'PLAYER 2',
                getPendingGarbage: (state) => state?.pendingGarbage || 0
            });
        }

        if (scene1 && scene2) {
            // Make scenes visible and active
            scene1.scene.setVisible(true);
            scene1.scene.setActive(true);
            scene2.scene.setVisible(true);
            scene2.scene.setActive(true);
            
            // Verify camera viewports are set correctly
            if (scene1.cameras && scene1.cameras.main) {
                console.log('[LocalMultiplayer] Player 1 viewport:', scene1.cameras.main.x, scene1.cameras.main.y, scene1.cameras.main.width, scene1.cameras.main.height);
            }
            if (scene2.cameras && scene2.cameras.main) {
                console.log('[LocalMultiplayer] Player 2 viewport:', scene2.cameras.main.x, scene2.cameras.main.y, scene2.cameras.main.width, scene2.cameras.main.height);
            }
            
            this.boardScenes = [scene1, scene2];
            console.log('[LocalMultiplayer] Board scenes ready:', {
                scene0: scene1.scene?.key,
                scene1: scene2.scene?.key,
                array: this.boardScenes
            });
        } else {
            throw new Error('Failed to create multiplayer board scenes');
        }
    }

    /**
     * Create separate Phaser game instances for each player
     * @private
     */
    async _createSeparatePhaserGames() {
        console.log('[LocalMultiplayer] Creating separate Phaser instances for each player...');

        const BoardScene = this.deps.BoardSceneClass || this.deps.MultiplayerBoardSceneClass;
        if (!BoardScene) {
            throw new Error('BoardScene or MultiplayerBoardScene class not available');
        }
        
        console.log('[LocalMultiplayer] Using scene class:', BoardScene.name || 'BoardScene');

        // Game configuration for each player
        const createGameConfig = (parent) => ({
            width: COLS * BLOCK_SIZE,
            height: ROWS * BLOCK_SIZE,
            parent: parent,
            type: Phaser.WEBGL,
            transparent: true,
            audio: { noAudio: true },
            banner: false,
            fps: { target: 60 },
            scale: {
                mode: Phaser.Scale.FIT,
                autoCenter: Phaser.Scale.NO_CENTER,
                width: COLS * BLOCK_SIZE,
                height: ROWS * BLOCK_SIZE,
            }
        });

        // Create Player 1 Phaser game instance
        console.log('[LocalMultiplayer] Creating Player 1 Phaser game...');
        this.p1PhaserGame = new Phaser.Game(createGameConfig('p1-phaser-container'));
        
        // Wait for game to initialize
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Add and start BoardScene for Player 1
        this.p1BoardScene = new BoardScene('P1Board');
        this.p1PhaserGame.scene.add('P1Board', this.p1BoardScene, true);
        console.log('[LocalMultiplayer] Player 1 scene created:', this.p1BoardScene.scene?.key);
        
        // Create Player 2 Phaser game instance
        console.log('[LocalMultiplayer] Creating Player 2 Phaser game...');
        this.p2PhaserGame = new Phaser.Game(createGameConfig('p2-phaser-container'));
        
        // Wait for game to initialize
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Add and start BoardScene for Player 2
        this.p2BoardScene = new BoardScene('P2Board');
        this.p2PhaserGame.scene.add('P2Board', this.p2BoardScene, true);
        console.log('[LocalMultiplayer] Player 2 scene created:', this.p2BoardScene.scene?.key);

        // Wait for scenes to fully initialize
        await new Promise(resolve => setTimeout(resolve, 200));

        console.log('[LocalMultiplayer] Separate Phaser instances created successfully');
    }

    /**
     * Teardown multiplayer board scenes
     * @private
     */
    _teardownBoardScenes() {
        console.log('[LocalMultiplayer] Tearing down board scenes...');
        
        const phaserGame = this.deps.phaserGame;
        if (!phaserGame?.scene) return;

        // Stop, hide, and remove board panel scenes
        ['BoardPanel1', 'BoardPanel2'].forEach((key) => {
            const scene = phaserGame.scene.getScene(key);
            if (scene) {
                console.log(`[LocalMultiplayer] Removing scene: ${key}`);
                
                // Clear the scene's camera viewport to prevent rendering
                if (scene.cameras?.main) {
                    scene.cameras.main.setViewport(0, 0, 0, 0);
                }
                
                // Hide the scene first
                scene.scene.setVisible(false);
                
                // Stop the scene (pauses updates)
                scene.scene.stop();
                
                // Remove the scene from the scene manager
                phaserGame.scene.remove(key);
            }
        });

        this.boardScenes = [];
        console.log('[LocalMultiplayer] Board scenes torn down');
    }

    /**
     * Move Phaser canvas to multiplayer container
     * @private
     */
    _movePhaserToMultiplayerContainer() {
        const phaserCanvas = this.deps.phaserGame?.canvas;
        const container = document.getElementById('phaser-multiplayer-container');

        if (phaserCanvas && container && phaserCanvas.parentElement !== container) {
            container.appendChild(phaserCanvas);
        }
    }

    /**
     * Resize Phaser game
     * @private
     */
    _resizePhaserGame(width, height, disableAutoCenter = false) {
        if (this.deps.phaserGame?.resize) {
            this.deps.phaserGame.resize(width, height, disableAutoCenter);
        }
    }

    /**
     * Activate Phaser multiplayer UI
     * @private
     */
    _activatePhaserMultiplayerUI() {
        document.body.classList.add('phaser-multiplayer-active');
    }

    /**
     * Deactivate Phaser multiplayer UI
     * @private
     */
    _deactivatePhaserMultiplayerUI() {
        document.body.classList.remove('phaser-multiplayer-active');
    }

    /**
     * Pause single player scene
     * @private
     */
    _pauseSinglePlayerScene() {
        const boardScene = this.deps.phaserGame?.scene?.getScene('BoardScene');
        if (boardScene) {
            boardScene.scene.pause();
            boardScene.scene.setVisible(false);
        }
    }

    /**
     * Resume single player scene
     * @private
     */
    _resumeSinglePlayerScene() {
        const boardScene = this.deps.phaserGame?.scene?.getScene('BoardScene');
        if (boardScene) {
            boardScene.scene.resume();
            boardScene.scene.setVisible(true);
        }
    }

    /**
     * Handle round end - check if match is over or start new round
     * @param {string} winner - 'player1' or 'player2'
     */
    async handleRoundEnd(winner) {
        console.log(`[LocalMultiplayer] Round ended! Winner: ${winner}`);
        
        // Increment round wins
        this.roundWins[winner]++;
        
        const winnerName = winner === 'player1' ? 'Player 1' : 'Player 2';
        const p1Wins = this.roundWins.player1;
        const p2Wins = this.roundWins.player2;
        
        // Check if someone won the match
        if (this.roundWins[winner] >= this.roundsToWin) {
            console.log(`[LocalMultiplayer] ${winnerName} wins the match! (${p1Wins}-${p2Wins})`);
            await this._showMatchEnd(winner, p1Wins, p2Wins);
            return;
        }
        
        // Show round end and start next round
        console.log(`[LocalMultiplayer] Starting next round... Score: ${p1Wins}-${p2Wins}`);
        await this._showRoundEnd(winner, p1Wins, p2Wins);
        await this._startNewRound();
    }

    /**
     * Show round end overlay
     * @private
     */
    async _showRoundEnd(winner, p1Wins, p2Wins) {
        const winnerName = winner === 'player1' ? 'Player 1' : 'Player 2';
        
        // Create overlay
        const overlay = document.createElement('div');
        overlay.id = 'round-end-overlay';
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.85);
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            z-index: 10000;
            animation: fadeIn 0.3s ease;
        `;
        
        overlay.innerHTML = `
            <div style="text-align: center; color: white;">
                <div style="font-size: 48px; margin-bottom: 30px; color: #10b981; font-weight: bold;">
                    🏆 ${winnerName} Wins Round! 🏆
                </div>
                <div style="font-size: 32px; margin-bottom: 40px;">
                    Frags: ${p1Wins} - ${p2Wins}
                </div>
                <div style="font-size: 24px; color: #94a3b8;">
                    First to ${this.roundsToWin} wins
                </div>
                <div style="font-size: 20px; color: #64748b; margin-top: 10px;">
                    Next round starting...
                </div>
            </div>
        `;
        
        document.body.appendChild(overlay);
        
        // Wait 3 seconds
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // Remove overlay with fade out
        overlay.style.opacity = '0';
        await new Promise(resolve => setTimeout(resolve, 300));
        overlay.remove();
    }

    /**
     * Start a new round
     * @private
     */
    async _startNewRound() {
        console.log('[LocalMultiplayer] Resetting for new round...');
        
        // Accumulate stats from this round into match totals before resetting
        this.matchStats.player1.score += this.multiplayerState.player1.score;
        this.matchStats.player1.lines += this.multiplayerState.player1.lines;
        this.matchStats.player2.score += this.multiplayerState.player2.score;
        this.matchStats.player2.lines += this.multiplayerState.player2.lines;
        
        console.log('[LocalMultiplayer] Match stats accumulated:', {
            p1: this.matchStats.player1,
            p2: this.matchStats.player2
        });
        
        // Reset multiplayer state
        this.multiplayerState.reset();
        this.multiplayerState.isPaused = true;
        
        // Create new shared seed
        const sharedSeed = Math.floor(Math.random() * 1000000) || 1;
        this.multiplayerState.sharedPieceSeed = sharedSeed;
        this.multiplayerState.player1.randomGenerator = seededRandom(sharedSeed);
        this.multiplayerState.player2.randomGenerator = seededRandom(sharedSeed);
        
        // Fill piece bags
        fillBag(this.multiplayerState.player1.nextPieces, this.multiplayerState.player1.randomGenerator);
        fillBag(this.multiplayerState.player2.nextPieces, this.multiplayerState.player2.randomGenerator);
        
        // Draw next pieces
        drawNextPieces(this.p1NextCanvases, this.multiplayerState.player1.nextPieces);
        drawNextPieces(this.p2NextCanvases, this.multiplayerState.player2.nextPieces);
        
        // Update stats
        this._updateMultiplayerStats();
        
        // Show countdown
        await this._showCountdown();
        
        // Spawn initial pieces
        spawnPiece(
            this.multiplayerState.player1,
            () => {
                drawNextPieces(this.p1NextCanvases, this.multiplayerState.player1.nextPieces);
                this._syncBoardScenes();
            },
            () => {}
        );
        
        spawnPiece(
            this.multiplayerState.player2,
            () => {
                drawNextPieces(this.p2NextCanvases, this.multiplayerState.player2.nextPieces);
                this._syncBoardScenes();
            },
            () => {}
        );
        
        this._syncBoardScenes();
        
        // Start game loop
        this.multiplayerState.isPaused = false;
        this.multiplayerState.lastTime = performance.now();
        this._startGameLoop();
        
        console.log('[LocalMultiplayer] New round started!');
    }

    /**
     * Show match end (someone won the required number of rounds)
     * @private
     */
    async _showMatchEnd(winner, p1Wins, p2Wins) {
        const winnerName = winner === 'player1' ? 'Player 1' : 'Player 2';
        
        // Accumulate final round stats before showing match end
        const finalP1Score = this.matchStats.player1.score + this.multiplayerState.player1.score;
        const finalP1Lines = this.matchStats.player1.lines + this.multiplayerState.player1.lines;
        const finalP2Score = this.matchStats.player2.score + this.multiplayerState.player2.score;
        const finalP2Lines = this.matchStats.player2.lines + this.multiplayerState.player2.lines;
        
        console.log('[LocalMultiplayer] Match ended! Final stats:', {
            p1: { frags: p1Wins, score: finalP1Score, lines: finalP1Lines },
            p2: { frags: p2Wins, score: finalP2Score, lines: finalP2Lines }
        });
        
        // Stop the game
        await this.onStop();
        
        // Show match result
        const overlay = document.createElement('div');
        overlay.id = 'match-end-overlay';
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.9);
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            z-index: 10000;
        `;
        
        overlay.innerHTML = `
            <div style="text-align: center; color: white;">
                <div style="font-size: 64px; margin-bottom: 30px; color: #10b981; font-weight: bold;">
                    👑 ${winnerName} WINS THE MATCH! 👑
                </div>
                <div style="font-size: 42px; margin-bottom: 20px;">
                    Final Frags: ${p1Wins} - ${p2Wins}
                </div>
                <div style="font-size: 28px; margin-bottom: 30px; color: #94a3b8;">
                    First to ${this.roundsToWin}
                </div>
                <div style="display: flex; gap: 80px; justify-content: center; margin-bottom: 60px;">
                    <div>
                        <div style="font-size: 24px; color: #94a3b8; margin-bottom: 10px;">Player 1</div>
                        <div style="font-size: 20px; color: #e2e8f0;">Score: ${finalP1Score.toLocaleString()}</div>
                        <div style="font-size: 20px; color: #e2e8f0;">Lines: ${finalP1Lines}</div>
                    </div>
                    <div>
                        <div style="font-size: 24px; color: #94a3b8; margin-bottom: 10px;">Player 2</div>
                        <div style="font-size: 20px; color: #e2e8f0;">Score: ${finalP2Score.toLocaleString()}</div>
                        <div style="font-size: 20px; color: #e2e8f0;">Lines: ${finalP2Lines}</div>
                    </div>
                </div>
                <button id="return-to-menu-btn" style="
                    font-size: 24px;
                    padding: 15px 40px;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    border: none;
                    border-radius: 8px;
                    color: white;
                    cursor: pointer;
                    font-weight: bold;
                    box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);
                    transition: transform 0.2s;
                ">
                    Return to Menu
                </button>
            </div>
        `;
        
        document.body.appendChild(overlay);
        
        // Handle return to menu button
        const returnBtn = document.getElementById('return-to-menu-btn');
        returnBtn.addEventListener('mouseenter', () => {
            returnBtn.style.transform = 'scale(1.05)';
        });
        returnBtn.addEventListener('mouseleave', () => {
            returnBtn.style.transform = 'scale(1)';
        });
        returnBtn.addEventListener('click', () => {
            overlay.remove();
            // Reset round wins for next match
            this.roundWins.player1 = 0;
            this.roundWins.player2 = 0;
            // Trigger mode change back to start screen
            window.location.reload(); // Simple approach - reload to start screen
        });
    }
}
