import Phaser from 'phaser';
import { BaseGameMode } from './BaseGameMode.js';
import { MultiplayerGameState } from '../multiplayer.js';
import { MultiPlayerState } from '../multi-player-state.js';
import {
    GAME_MODES, COLS, ROWS, BLOCK_SIZE,
} from '../constants.js';
import { spawnPiece, fillBag, softDrop } from '../game.js';
import { seededRandom } from '../../utils/helpers.js';
import { drawNextPieces } from '../../rendering/draw.js';
import { LocalMatchConfigModal } from '../../ui/local-match-config-modal.js';

/**
 * LocalMultiplayerMode - Local 2-4 player competitive mode
 *
 * Manages:
 * - MultiplayerGameState with multiple player instances
 * - Multiple Phaser board scenes (side-by-side or grid layout)
 * - Multiplayer game loop with garbage system
 * - Shared RNG seed for fairness
 * - Configuration options (win conditions, player count, etc.)
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
        this.playerNextCanvases = new Map();

        // Match configuration (from modal)
        this.matchConfig = null;
        this.configModal = null;
        this.configuredForStart = false; // Track if config modal has been shown

        // Round tracking (frags) - will be configured by modal
        this.roundWins = {
            player1: 0,
            player2: 0,
            player3: 0,
            player4: 0,
        };

        // Cumulative match stats (preserved across rounds)
        this.matchStats = {
            player1: { score: 0, lines: 0 },
            player2: { score: 0, lines: 0 },
            player3: { score: 0, lines: 0 },
            player4: { score: 0, lines: 0 },
        };
    }

    getModeId() {
        return GAME_MODES.LOCAL_MULTIPLAYER;
    }

    getDisplayName() {
        return 'Local MP';
    }

    /**
     * Called when local multiplayer mode is selected
     */
    async onActivate() {
        await super.onActivate();

        console.log('[LocalMultiplayer] Activating local multiplayer mode...');

        // Reset configuration state on each activation
        this.matchConfig = null;
        this.configuredForStart = false;

        // Always create a fresh config modal
        if (this.configModal) {
            this.configModal.destroy();
        }

        this.configModal = new LocalMatchConfigModal(
            (config) => {
                this.handleConfigurationComplete(config);
            },
            () => {
                this.handleConfigurationCancelled();
            },
        );

        this.configModal.show();
        console.log('[LocalMultiplayer] Showing configuration modal');
    }

    /**
     * Called when configuration modal is submitted
     */
    async handleConfigurationComplete(config) {
        console.log('[LocalMultiplayer] Configuration received:', config);

        this.matchConfig = config;
        this.configuredForStart = true;

        // Now setup the UI for the configured number of players
        await this._setupMultiplayerUI();

        console.log('[LocalMultiplayer] UI setup complete, starting match...');

        // Automatically start the match after configuration
        await this.onStart();
    }

    /**
     * Called when configuration modal is cancelled
     */
    async handleConfigurationCancelled() {
        console.log('[LocalMultiplayer] Configuration cancelled, returning to start modal');
        console.log('[LocalMultiplayer] Current mode state - isActive:', this.isActive, 'isRunning:', this.isRunning);

        // Manually deactivate this mode since we can't access gameModeManager
        // (gameModeManager is not in deps to avoid circular dependency)
        console.log('[LocalMultiplayer] Manually resetting mode state...');
        this.isActive = false;
        this.isRunning = false;
        this.isPaused = false;

        // Reset configuration
        this.matchConfig = null;
        this.configuredForStart = false;

        // Show intro animation background with logo
        const { introAnimation } = await import('../../ui/intro-animation.js');
        if (introAnimation && this.deps.soundManager) {
            introAnimation.showBackgroundOnly(this.deps.soundManager);
        }

        // Show start modal
        if (this.deps.modalManager) {
            this.deps.modalManager.show('start');
        }

        console.log('[LocalMultiplayer] handleConfigurationCancelled complete - mode reset');
    }

    /**
     * Setup multiplayer UI based on configuration
     */
    async _setupMultiplayerUI() {
        const numPlayers = this.matchConfig?.numPlayers || 2;

        console.log(`[LocalMultiplayer] Setting up UI for ${numPlayers} players`);

        // Collect next piece canvas references for all players (main boards rendered by Phaser)
        this.playerNextCanvases.clear();
        for (let i = 1; i <= 4; i++) {
            const canvases = Array.from({ length: 3 }, (_, idx) => document.getElementById(`p${i}-next-${idx}`));
            if (canvases.every(Boolean)) {
                this.playerNextCanvases.set(i, canvases);
            }
        }

        this.p1NextCanvases = this.playerNextCanvases.get(1) || [];
        this.p2NextCanvases = this.playerNextCanvases.get(2) || [];

        if (!this.p1NextCanvases.length || !this.p2NextCanvases.length) {
            throw new Error('Multiplayer next piece canvases not found');
        }

        // Hide single player container
        const singlePlayerContainer = document.getElementById('single-player-container');
        if (singlePlayerContainer) {
            singlePlayerContainer.style.display = 'none';
        }

        // Hide single player stats bar
        const statsBar = document.querySelector('.single-player-stats-bar');
        if (statsBar) {
            statsBar.style.display = 'none';
        }

        // Show multiplayer container
        const multiplayerContainer = document.getElementById('multiplayer-container');
        if (multiplayerContainer) {
            multiplayerContainer.style.display = 'flex';
        }

        // Update layout for player count
        this._updatePlayerLayout(numPlayers);

        // Create separate Phaser game instances for each player
        await this._createSeparatePhaserGames();

        // Pause single player scene
        this._pauseSinglePlayerScene();

        console.log('[LocalMultiplayer] UI setup complete');
    }

    /**
     * Update UI layout based on number of players
     * @private
     */
    _updatePlayerLayout(numPlayers) {
        const gameArea = document.querySelector('.multiplayer-game-area');
        if (!gameArea) return;

        // Remove all player count classes
        gameArea.classList.remove('players-2', 'players-3', 'players-4');

        // Add appropriate class for current player count
        gameArea.classList.add(`players-${numPlayers}`);

        // Show/hide player cards
        for (let i = 1; i <= 4; i++) {
            const playerCard = document.getElementById(`player-${i}-card`);
            if (playerCard) {
                if (i <= numPlayers) {
                    playerCard.style.display = 'flex';
                    playerCard.removeAttribute('aria-hidden');
                } else {
                    playerCard.style.display = 'none';
                    playerCard.setAttribute('aria-hidden', 'true');
                }
            }
        }

        console.log(`[LocalMultiplayer] Layout updated for ${numPlayers} players`);
    }

    /**
     * Called when user clicks "Start Game"
     */
    async onStart() {
        console.log('[LocalMultiplayer] Starting game...');

        // Check if configuration has been set
        if (!this.configuredForStart || !this.matchConfig) {
            console.log('[LocalMultiplayer] Configuration not set, waiting for user to configure');
            // Don't call super.onStart() yet - we're not ready to run
            // The config modal is already shown from onActivate()
            // When user completes config, handleConfigurationComplete() will call onStart() again
            return;
        }

        // Now we're ready to actually start the game
        await super.onStart();

        // Hide start modal immediately
        this.deps.modalManager.hideAll();

        // Reset match stats for new game
        this.matchStats = {
            player1: { score: 0, lines: 0 },
            player2: { score: 0, lines: 0 },
            player3: { score: 0, lines: 0 },
            player4: { score: 0, lines: 0 },
        };
        this.roundWins = {
            player1: 0,
            player2: 0,
            player3: 0,
            player4: 0,
        };

        // Store match start time for time-based win conditions
        this.matchStartTime = Date.now();

        // Initialize multiplayer state with new MultiPlayerState
        const numPlayers = this.matchConfig?.numPlayers || 2;
        console.log(`[LocalMultiplayer] Creating MultiPlayerState for ${numPlayers} players`);

        this.multiplayerState = new MultiPlayerState(numPlayers);
        this.multiplayerState.setMatchConfig(this.matchConfig);
        this.multiplayerState.reset();
        this.multiplayerState.isPaused = true;

        // Activate Phaser multiplayer UI
        this._activatePhaserMultiplayerUI();

        // Get references to the board scenes (created in _createSeparatePhaserGames)
        if (!this.boardScenes || this.boardScenes.length === 0) {
            throw new Error('Board scenes not initialized. Call onActivate first.');
        }

        console.log(`[LocalMultiplayer] Using ${this.boardScenes.length} board scenes`);

        // Create shared RNG seed for fairness
        const sharedSeed = Math.floor(Math.random() * 1000000) || 1;
        this.multiplayerState.sharedPieceSeed = sharedSeed;

        // Initialize RNG and piece bags for all players
        for (let i = 0; i < numPlayers; i++) {
            const player = this.multiplayerState.players[i];
            player.randomGenerator = seededRandom(sharedSeed);
            fillBag(player.nextPieces, player.randomGenerator);
        }
        console.log(`[LocalMultiplayer] Shared seed: ${sharedSeed}`);

        // Draw initial next pieces for all players
        for (let i = 0; i < numPlayers; i++) {
            const playerNum = i + 1;
            const canvases = this.playerNextCanvases.get(playerNum);
            if (canvases && canvases.length) {
                drawNextPieces(canvases, this.multiplayerState.players[i].nextPieces);
            }
        }

        // Update stats display
        this._updateMultiplayerStats();

        // Show countdown
        await this._showCountdown();

        // Spawn first pieces for all players
        this.multiplayerState.lastTime = performance.now();

        // Spawn pieces for all configured players
        for (let i = 0; i < numPlayers; i++) {
            const playerNum = i + 1;
            const nextCanvases = this.playerNextCanvases.get(playerNum);
            const playerState = this.multiplayerState.players[i];

            // Spawn initial piece (no garbage on first spawn)
            spawnPiece(playerState, () => {
                if (nextCanvases) {
                    drawNextPieces(nextCanvases, playerState.nextPieces);
                }
                this._syncBoardScenes();
            }, () => this._handleGameOver(i));

            console.log(`[LocalMultiplayer] Spawned initial piece for Player ${playerNum}`);
        }

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

        // Hide and destroy config modal
        if (this.configModal) {
            this.configModal.hide();
            this.configModal.destroy();
            this.configModal = null;
        }

        // Reset configuration state
        this.matchConfig = null;
        this.configuredForStart = false;

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
                score: this.multiplayerState?.players[0].score || 0,
                lines: this.multiplayerState?.players[0].totalLinesCleared || 0,
                level: this.multiplayerState?.players[0].level || 1,
            },
            player2: {
                score: this.multiplayerState?.players[1].score || 0,
                lines: this.multiplayerState?.players[1].totalLinesCleared || 0,
                level: this.multiplayerState?.players[1].level || 1,
            },
        };
    }

    // ===== Private Methods =====

    /**
     * Start the multiplayer game loop
     * @private
     */
    _startGameLoop() {
        let frameCount = 0;

        const loop = (currentTime) => {
            if (!this.isRunning || this.multiplayerState.isGameOver) {
                console.log('[LocalMultiplayer] Game loop stopped:', { isRunning: this.isRunning, isGameOver: this.multiplayerState.isGameOver });
                return;
            }

            if (this.multiplayerState.isPaused) {
                this.animationFrameId = requestAnimationFrame(loop);
                return;
            }

            const delta = currentTime - this.multiplayerState.lastTime;
            this.multiplayerState.lastTime = currentTime;

            // Debug log every 60 frames (once per second at 60fps)
            frameCount++;
            if (frameCount % 60 === 0) {
                console.log('[LocalMultiplayer] Game loop running. Players:', this.multiplayerState.numPlayers, 'Delta:', Math.floor(delta));
                // Log player state periodically to debug gravity
                for (let i = 0; i < this.multiplayerState.numPlayers; i++) {
                    const ps = this.multiplayerState.players[i];
                    console.log(`  P${i + 1}: piece=${!!ps.currentPiece}, counter=${Math.floor(ps.dropCounter)}, interval=${ps.dropInterval}, processing=${ps.isProcessingPhysics}`);
                }
            }

            // Update all players using the core game physics
            for (let playerIndex = 0; playerIndex < this.multiplayerState.numPlayers; playerIndex++) {
                const playerNum = playerIndex + 1; // 1-based for compatibility
                const playerState = this.multiplayerState.players[playerIndex];

                // Skip dead players
                if (!playerState.isAlive) {
                    continue;
                }

                // Debug log for first few frames
                if (frameCount <= 5) {
                    console.log(`[LocalMultiplayer] P${playerNum} state:`, {
                        hasCurrentPiece: !!playerState.currentPiece,
                        isProcessing: playerState.isProcessingPhysics,
                        dropCounter: playerState.dropCounter,
                        dropInterval: playerState.dropInterval,
                        delta,
                    });
                }

                if (!playerState.isProcessingPhysics && playerState.currentPiece) {
                    // Log before and after adding delta (first few frames)
                    if (frameCount <= 3) {
                        console.log(`[LocalMultiplayer] P${playerNum} BEFORE: dropCounter=${playerState.dropCounter}, delta=${delta}`);
                    }

                    playerState.dropCounter += delta;

                    if (frameCount <= 3) {
                        console.log(`[LocalMultiplayer] P${playerNum} AFTER: dropCounter=${playerState.dropCounter}`);
                    }

                    if (playerState.dropCounter > playerState.dropInterval) {
                        // Use proper multiplayer callbacks (from main.js) to handle garbage and spawning
                        const callbacks = this.deps.getMultiplayerPhysicsCallbacks?.(playerNum)
                            || this._getPhysicsCallbacks();

                        console.log(`[LocalMultiplayer] Dropping piece for P${playerNum}, counter was ${playerState.dropCounter}`);

                        softDrop(
                            playerState,
                            () => this.deps.soundManager.sfxPlayer.playDrop(),
                            callbacks,
                        );
                    }
                }
            }

            // Update stats display
            this._updateMultiplayerStats();

            // Sync board scenes
            this._syncBoardScenes();

            // Continue loop
            this.animationFrameId = requestAnimationFrame(loop);
        };

        console.log('[LocalMultiplayer] Starting game loop...');
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
            onLineClear: () => {
                this.deps.soundManager.sfxPlayer.playLineClear();
            },
            onLevelUp: () => this.deps.soundManager.sfxPlayer.playLevelUp(),
            onHardDrop: () => this.deps.soundManager.sfxPlayer.playHardDrop(),
            onGarbageReceived: () => this.deps.soundManager.sfxPlayer.playGarbageReceived?.(),
            onDrop: () => this.deps.soundManager.sfxPlayer.playDrop(),
            // Trigger combo visual effects
            triggerCombo: (comboCount) => {
                const settings = this.deps.settingsManager.get();
                // Show combo effects on all active board scenes
                this.boardScenes.forEach((scene) => {
                    if (scene && settings.comboPopupEffect && scene.showComboPopup) {
                        scene.showComboPopup(comboCount);
                    }
                });
            },
            // Trigger cascade wave visual effect
            triggerCascadeWave: (cascadeCount) => {
                // Show cascade wave on all active board scenes
                this.boardScenes.forEach((scene) => {
                    if (scene && scene.sharedEffects && scene.sharedEffects.showCascadeWave) {
                        scene.sharedEffects.showCascadeWave(cascadeCount);
                    }
                });
            },
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

        const { numPlayers } = this.multiplayerState;

        for (let i = 0; i < numPlayers; i++) {
            const playerNum = i + 1;
            const playerState = this.multiplayerState.players[i];
            if (!playerState) continue;

            const matchKey = `player${playerNum}`;
            const matchTotals = this.matchStats[matchKey] || { score: 0, lines: 0 };

            const totalScore = (matchTotals.score || 0) + (playerState.score || 0);
            const totalLines = (matchTotals.lines || 0) + (playerState.totalLinesCleared || 0);
            const totalLevel = playerState.level ?? 1;
            const totalGarbage = this.multiplayerState.garbageQueues?.[i]?.getTotalLines?.() ?? 0;
            const roundFrags = this.roundWins[matchKey] ?? 0;

            const fragsEl = document.getElementById(`p${playerNum}-frags`);
            const scoreEl = document.getElementById(`p${playerNum}-score`);
            const linesEl = document.getElementById(`p${playerNum}-lines`);
            const levelEl = document.getElementById(`p${playerNum}-level`);
            const garbageEl = document.getElementById(`p${playerNum}-garbage`);

            if (fragsEl) fragsEl.textContent = roundFrags;
            if (scoreEl) scoreEl.textContent = totalScore;
            if (linesEl) linesEl.textContent = totalLines;
            if (levelEl) levelEl.textContent = totalLevel;
            if (garbageEl) garbageEl.textContent = totalGarbage;
        }

        // Update board-level frag displays for all players (used in 3-4 player mode)
        for (let i = 1; i <= numPlayers; i++) {
            const boardFragDisplay = document.getElementById(`p${i}-board-frags`);
            if (boardFragDisplay) {
                const playerKey = `player${i}`;
                boardFragDisplay.textContent = `${this.roundWins[playerKey] || 0} F`;
            }
        }
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
            // Use array-based access for new MultiPlayerState
            const playerState = this.multiplayerState.players[index];
            const playerNum = index + 1;

            if (!playerState) {
                console.warn(`[LocalMultiplayer] No player state for index ${index}`);
                return;
            }

            if (scene && scene.syncFromGameState) {
                scene.syncFromGameState(playerState);
            } else {
                console.warn(`[LocalMultiplayer] Scene ${index} cannot sync:`, {
                    hasScene: !!scene,
                    hasSyncMethod: scene ? !!scene.syncFromGameState : false,
                });
            }
        });
    }

    /**
     * Handle game over for a player
     * @private
     */
    async _handleGameOver(playerIndex) {
        console.log(`[LocalMultiplayer] Player ${playerIndex + 1} lost!`);

        // Mark player as dead and handle frag attribution
        this.multiplayerState.handlePlayerDeath(playerIndex);

        // Clear the eliminated player's current piece so it stops dropping
        const playerState = this.multiplayerState.players[playerIndex];
        if (playerState && playerState.currentPiece) {
            playerState.currentPiece = null;
            console.log(`[LocalMultiplayer] Cleared current piece for eliminated Player ${playerIndex + 1}`);
        }

        // Show death animation for the eliminated player
        this._showPlayerDeathAnimation(playerIndex);

        // For 2 players, determine winner immediately and pause
        if (this.multiplayerState.numPlayers === 2) {
            // ONLY pause when round ends (2 players)
            this.multiplayerState.isPaused = true;
            const winnerIndex = playerIndex === 0 ? 1 : 0;
            const winnerKey = `player${winnerIndex + 1}`;

            // Show victory animation for the winner
            this._showVictoryAnimation(winnerIndex);

            // Wait for victory animation before showing round end
            await new Promise((resolve) => setTimeout(resolve, 1500));

            await this.handleRoundEnd(winnerKey);
        } else {
            // For 3-4 players, check if we need to end the round
            const alivePlayers = this.multiplayerState.players.filter((p) => p.isAlive);
            console.log(`[LocalMultiplayer] ${alivePlayers.length} players still alive`);

            if (alivePlayers.length <= 1) {
                // Round ends - pause the game
                this.multiplayerState.isPaused = true;

                // Find last player standing
                const winnerIndex = this.multiplayerState.players.findIndex((p) => p.isAlive);
                const winnerKey = winnerIndex >= 0 ? `player${winnerIndex + 1}` : null;
                if (winnerKey && winnerIndex >= 0) {
                    // Show victory animation for the winner
                    this._showVictoryAnimation(winnerIndex);

                    // Wait a bit for victory animation before showing round end
                    await new Promise((resolve) => setTimeout(resolve, 1500));

                    await this.handleRoundEnd(winnerKey);
                }
            }
            // If multiple players still alive, DO NOT pause - continue the match
        }
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
        const { phaserGame } = this.deps;
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
                height: boardHeight,
            };

            // Player 2 viewport (right side, with gap)
            const player2Viewport = {
                x: singleBoardWidth + this.boardGap,
                y: 0,
                width: singleBoardWidth,
                height: boardHeight,
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
                getPendingGarbage: (state) => state?.pendingGarbage || 0,
            });

            phaserGame.scene.start('BoardPanel2', {
                playerId: 2,
                viewport: player2Viewport,
                playerLabel: 'PLAYER 2',
                getPendingGarbage: (state) => state?.pendingGarbage || 0,
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
                height: boardHeight,
            };

            // Player 2 viewport (right side, with gap)
            const player2Viewport = {
                x: singleBoardWidth + this.boardGap,
                y: 0,
                width: singleBoardWidth,
                height: boardHeight,
            };

            // Restart scenes - stop them first, then start with new data
            phaserGame.scene.stop('BoardPanel1');
            phaserGame.scene.stop('BoardPanel2');

            // Start both scenes - they should run in parallel
            phaserGame.scene.start('BoardPanel1', {
                playerId: 1,
                viewport: player1Viewport,
                playerLabel: 'PLAYER 1',
                getPendingGarbage: (state) => state?.pendingGarbage || 0,
            });

            phaserGame.scene.start('BoardPanel2', {
                playerId: 2,
                viewport: player2Viewport,
                playerLabel: 'PLAYER 2',
                getPendingGarbage: (state) => state?.pendingGarbage || 0,
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
                array: this.boardScenes,
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
        const numPlayers = this.matchConfig?.numPlayers || 2;
        console.log(`[LocalMultiplayer] Creating separate Phaser instances for ${numPlayers} players...`);

        const BoardScene = this.deps.BoardSceneClass || this.deps.MultiplayerBoardSceneClass;
        if (!BoardScene) {
            throw new Error('BoardScene or MultiplayerBoardScene class not available');
        }

        console.log('[LocalMultiplayer] Using scene class:', BoardScene.name || 'BoardScene');

        // Game configuration for each player
        const createGameConfig = (parent) => ({
            width: COLS * BLOCK_SIZE,
            height: ROWS * BLOCK_SIZE,
            parent,
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
            },
        });

        // Arrays to store Phaser games and scenes
        this.phaserGames = [];
        this.boardScenes = [];

        // Create Phaser instance for each player
        for (let i = 1; i <= numPlayers; i++) {
            console.log(`[LocalMultiplayer] Creating Player ${i} Phaser game...`);

            const phaserGame = new Phaser.Game(createGameConfig(`p${i}-phaser-container`));

            // Wait for game to initialize
            await new Promise((resolve) => setTimeout(resolve, 100));

            // Add and start BoardScene
            const boardScene = new BoardScene(`P${i}Board`);
            phaserGame.scene.add(`P${i}Board`, boardScene, true);
            console.log(`[LocalMultiplayer] Player ${i} scene created:`, boardScene.scene?.key);

            // Store references
            this.phaserGames.push(phaserGame);
            this.boardScenes.push(boardScene);

            // Also maintain legacy p1/p2 references for backwards compatibility
            if (i === 1) {
                this.p1PhaserGame = phaserGame;
                this.p1BoardScene = boardScene;
            } else if (i === 2) {
                this.p2PhaserGame = phaserGame;
                this.p2BoardScene = boardScene;
            } else if (i === 3) {
                this.p3PhaserGame = phaserGame;
                this.p3BoardScene = boardScene;
            } else if (i === 4) {
                this.p4PhaserGame = phaserGame;
                this.p4BoardScene = boardScene;
            }
        }

        // Wait for all scenes to fully initialize
        await new Promise((resolve) => setTimeout(resolve, 200));

        console.log(`[LocalMultiplayer] ${numPlayers} Phaser instances created successfully`);
    }

    /**
     * Teardown multiplayer board scenes
     * @private
     */
    _teardownBoardScenes() {
        console.log('[LocalMultiplayer] Tearing down board scenes...');

        const { phaserGame } = this.deps;
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

        // Apply player colors to UI elements
        this._applyPlayerColors();
    }

    /**
     * Apply player-specific colors to UI elements
     * Colors player labels, borders, and other visual indicators
     * @private
     */
    _applyPlayerColors() {
        const numPlayers = this.multiplayerState?.numPlayers || 2;

        for (let i = 0; i < numPlayers; i++) {
            const playerNum = i + 1;
            const playerColor = this.multiplayerState.getPlayerColor(i);

            if (!playerColor) continue;

            // Apply color to player label
            const label = document.querySelector(`#player-${playerNum}-card .player-board-label`);
            if (label) {
                label.style.color = playerColor.primary;
                label.style.textShadow = `0 0 10px ${playerColor.glow}, 0 0 20px ${playerColor.glow}`;
                label.style.fontWeight = 'bold';
            }

            // Apply color to player card border/glow
            const card = document.getElementById(`player-${playerNum}-card`);
            if (card) {
                card.style.borderColor = playerColor.primary;
                card.style.boxShadow = `0 0 20px ${playerColor.glow}`;
                card.style.setProperty('--player-primary', playerColor.primary);
                card.style.setProperty('--player-primary-light', playerColor.light || playerColor.primary);
                card.style.setProperty('--player-glow', playerColor.glow || `${playerColor.primary}55`);
            }

            // Apply color to board border
            const border = document.getElementById(`p${playerNum}-border`);
            if (border) {
                border.style.borderColor = playerColor.primary;
                border.style.boxShadow = `
                    0 0 30px ${playerColor.glow},
                    inset 0 0 20px ${playerColor.glow}
                `;
            }

            // Apply color to phaser container border
            const container = document.getElementById(`p${playerNum}-phaser-container`);
            if (container) {
                container.style.border = `2px solid ${playerColor.primary}`;
                container.style.boxShadow = `0 0 20px ${playerColor.glow}`;
            }

            console.log(`[LocalMultiplayer] Applied ${playerColor.name} color to Player ${playerNum}`);
        }
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
     * Get the target value for the win condition
     */
    _getWinTarget() {
        if (!this.matchConfig) {
            return 7; // Default fallback
        }
        return this.matchConfig.endConditionValue || 7;
    }

    /**
     * Get win condition display text
     */
    _getWinConditionText() {
        if (!this.matchConfig) {
            return 'First to 7 frags wins';
        }

        const config = this.matchConfig;
        switch (config.endCondition) {
        case 'frags':
            return `First to ${config.endConditionValue} frags wins`;
        case 'time':
            return `${config.endConditionValue} minute time limit`;
        case 'points':
            return `First to ${config.endConditionValue * 1000} points wins`;
        case 'lines':
            return `First to ${config.endConditionValue} lines wins`;
        case 'never':
            return 'Play until manual end';
        default:
            return `First to ${config.endConditionValue} frags wins`;
        }
    }

    /**
     * Handle round end - check if match is over or start new round
     * @param {string} winner - 'player1' or 'player2'
     */
    async handleRoundEnd(winner) {
        console.log(`[LocalMultiplayer] Round ended! Winner: ${winner}`);

        // Increment round wins (frags)
        this.roundWins[winner]++;

        const winnerName = winner === 'player1' ? 'Player 1' : 'Player 2';
        const p1Wins = this.roundWins.player1;
        const p2Wins = this.roundWins.player2;

        // Check if someone won the match based on win condition
        const wonMatch = this._checkMatchWinCondition(winner);

        if (wonMatch) {
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
     * Check if the match win condition has been met
     */
    _checkMatchWinCondition(lastRoundWinner) {
        if (!this.matchConfig) {
            // Fallback to old behavior
            return this.roundWins[lastRoundWinner] >= 7;
        }

        const config = this.matchConfig;

        switch (config.endCondition) {
        case 'frags':
            // Frags are round wins
            return this.roundWins[lastRoundWinner] >= config.endConditionValue;

        case 'time': {
            // Check if time limit has been reached
            const elapsedMinutes = (Date.now() - this.matchStartTime) / 1000 / 60;
            return elapsedMinutes >= config.endConditionValue;
        }

        case 'points': {
            // Check if either player reached the score target
            const targetScore = config.endConditionValue * 1000;
            const p1TotalScore = this.matchStats.player1.score + this.multiplayerState.players[0].score;
            const p2TotalScore = this.matchStats.player2.score + this.multiplayerState.players[1].score;
            return p1TotalScore >= targetScore || p2TotalScore >= targetScore;
        }

        case 'lines': {
            // Check if either player cleared enough lines
            const p1TotalLines = this.matchStats.player1.lines + this.multiplayerState.players[0].totalLinesCleared;
            const p2TotalLines = this.matchStats.player2.lines + this.multiplayerState.players[1].totalLinesCleared;
            return p1TotalLines >= config.endConditionValue || p2TotalLines >= config.endConditionValue;
        }

        case 'never':
            // Never end automatically
            return false;

        default:
            return this.roundWins[lastRoundWinner] >= config.endConditionValue;
        }
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
                    ${this._getWinConditionText()}
                </div>
                <div style="font-size: 20px; color: #64748b; margin-top: 10px;">
                    Next round starting...
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        // Wait 3 seconds
        await new Promise((resolve) => setTimeout(resolve, 3000));

        // Remove overlay with fade out
        overlay.style.opacity = '0';
        await new Promise((resolve) => setTimeout(resolve, 300));
        overlay.remove();
    }

    /**
     * Start a new round
     * @private
     */
    async _startNewRound() {
        console.log('[LocalMultiplayer] Resetting for new round...');

        // Clear death animations from previous round
        this._clearDeathAnimations();

        const { numPlayers } = this.multiplayerState;

        // Accumulate stats from this round into match totals before resetting
        const accumulatedLog = {};
        for (let i = 0; i < numPlayers; i++) {
            const playerNum = i + 1;
            const matchKey = `player${playerNum}`;
            const playerState = this.multiplayerState.players[i];
            if (!playerState) continue;

            if (!this.matchStats[matchKey]) {
                this.matchStats[matchKey] = { score: 0, lines: 0 };
            }

            this.matchStats[matchKey].score += playerState.score || 0;
            this.matchStats[matchKey].lines += playerState.totalLinesCleared || 0;
            accumulatedLog[matchKey] = this.matchStats[matchKey];
        }

        console.log('[LocalMultiplayer] Match stats accumulated:', accumulatedLog);

        // Reset multiplayer state
        this.multiplayerState.reset();
        this.multiplayerState.isPaused = true;

        // Create new shared seed and reinitialize RNG for all players
        const sharedSeed = Math.floor(Math.random() * 1000000) || 1;
        this.multiplayerState.sharedPieceSeed = sharedSeed;

        for (let i = 0; i < numPlayers; i++) {
            const player = this.multiplayerState.players[i];
            player.randomGenerator = seededRandom(sharedSeed);
            fillBag(player.nextPieces, player.randomGenerator);
        }

        // Draw next pieces for all players
        for (let i = 0; i < numPlayers; i++) {
            const playerNum = i + 1;
            const canvases = this.playerNextCanvases.get(playerNum);
            if (canvases && canvases.length) {
                drawNextPieces(canvases, this.multiplayerState.players[i].nextPieces);
            }
        }

        // Update stats
        this._updateMultiplayerStats();

        // Wait 1 second before showing countdown
        await new Promise((resolve) => setTimeout(resolve, 1000));

        // Show countdown
        await this._showCountdown();

        // Spawn initial pieces for all configured players
        for (let i = 0; i < numPlayers; i++) {
            const playerNum = i + 1;
            const nextCanvases = this.playerNextCanvases.get(playerNum);

            spawnPiece(
                this.multiplayerState.players[i],
                () => {
                    if (nextCanvases) {
                        drawNextPieces(nextCanvases, this.multiplayerState.players[i].nextPieces);
                    }
                    this._syncBoardScenes();
                },
                () => this._handleGameOver(i),
            );

            console.log(`[LocalMultiplayer] Spawned piece for Player ${playerNum} in new round`);
        }

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
        const finalP1Score = this.matchStats.player1.score + this.multiplayerState.players[0].score;
        const finalP1Lines = this.matchStats.player1.lines + this.multiplayerState.players[0].totalLinesCleared;
        const finalP2Score = this.matchStats.player2.score + this.multiplayerState.players[1].score;
        const finalP2Lines = this.matchStats.player2.lines + this.multiplayerState.players[1].totalLinesCleared;

        console.log('[LocalMultiplayer] Match ended! Final stats:', {
            p1: { frags: p1Wins, score: finalP1Score, lines: finalP1Lines },
            p2: { frags: p2Wins, score: finalP2Score, lines: finalP2Lines },
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
                    ${this._getWinConditionText()}
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
            this.roundWins.player3 = 0;
            this.roundWins.player4 = 0;
            // Trigger mode change back to start screen
            window.location.reload(); // Simple approach - reload to start screen
        });
    }

    /**
     * Show death animation when a player is eliminated
     * @private
     */
    _showPlayerDeathAnimation(playerIndex) {
        const playerNum = playerIndex + 1;
        const boardScene = this.boardScenes[playerIndex];

        if (!boardScene) {
            console.warn(`[LocalMultiplayer] No board scene found for Player ${playerNum}`);
            return;
        }

        console.log(`[LocalMultiplayer] Showing death animation for Player ${playerNum}`);

        // === PHASER EFFECTS ===
        this._createEliminationExplosion(boardScene, playerIndex);

        // Get the Phaser container for this player
        const phaserContainer = document.getElementById(`p${playerNum}-phaser-container`);
        if (!phaserContainer) {
            console.warn(`[LocalMultiplayer] No phaser container found for Player ${playerNum}`);
            return;
        }

        // Create death overlay
        const deathOverlay = document.createElement('div');
        deathOverlay.className = 'player-death-overlay';
        deathOverlay.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0);
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            z-index: 100;
            pointer-events: none;
            transition: background 0.5s ease;
        `;

        // Create skull/death icon
        const deathIcon = document.createElement('div');
        deathIcon.style.cssText = `
            font-size: 80px;
            margin-bottom: 10px;
            opacity: 0;
            transform: scale(0.5) rotate(-45deg);
            transition: all 0.5s cubic-bezier(0.68, -0.55, 0.265, 1.55);
        `;
        deathIcon.textContent = '💀';

        // Create "ELIMINATED" text
        const eliminatedText = document.createElement('div');
        eliminatedText.style.cssText = `
            font-family: Arial, sans-serif;
            font-size: 28px;
            font-weight: bold;
            color: #ef4444;
            text-shadow:
                0 0 10px rgba(239, 68, 68, 0.8),
                0 0 20px rgba(239, 68, 68, 0.6);
            opacity: 0;
            transform: translateY(20px);
            transition: all 0.5s ease 0.2s;
        `;
        eliminatedText.textContent = 'ELIMINATED';

        deathOverlay.appendChild(deathIcon);
        deathOverlay.appendChild(eliminatedText);

        // Make container relative for absolute positioning
        if (phaserContainer.style.position !== 'relative') {
            phaserContainer.style.position = 'relative';
        }

        phaserContainer.appendChild(deathOverlay);

        // Delay overlay appearance to let fade effect play first
        setTimeout(() => {
            // Trigger animations
            requestAnimationFrame(() => {
                deathOverlay.style.background = 'rgba(0, 0, 0, 0.75)';
                deathIcon.style.opacity = '1';
                deathIcon.style.transform = 'scale(1) rotate(0deg)';
                eliminatedText.style.opacity = '1';
                eliminatedText.style.transform = 'translateY(0)';
            });
        }, 1000); // Show overlay after gentle fade (1 second)

        // Dim the board scene if possible
        if (boardScene.cameras && boardScene.cameras.main) {
            boardScene.cameras.main.setAlpha(0.3);
        }

        // Store reference for cleanup if needed
        if (!this.deathOverlays) {
            this.deathOverlays = [];
        }
        this.deathOverlays[playerIndex] = deathOverlay;

        console.log(`[LocalMultiplayer] Death animation displayed for Player ${playerNum}`);
    }

    /**
     * Clear all death overlays (when starting new round)
     * @private
     */
    _clearDeathAnimations() {
        console.log('[LocalMultiplayer] Clearing death animations, overlays:', this.deathOverlays?.length || 0);

        // Clear overlay array
        if (this.deathOverlays && this.deathOverlays.length > 0) {
            this.deathOverlays.forEach((overlay, index) => {
                if (overlay) {
                    console.log(`[LocalMultiplayer] Removing overlay for player ${index + 1}`);
                    if (overlay.parentElement) {
                        overlay.remove();
                    }

                    // Restore board scene alpha
                    const boardScene = this.boardScenes[index];
                    if (boardScene && boardScene.cameras && boardScene.cameras.main) {
                        boardScene.cameras.main.setAlpha(1.0);
                        console.log(`[LocalMultiplayer] Restored alpha for player ${index + 1}`);
                    }
                }
            });
        }

        // Also search for any lingering overlays in the DOM (safety cleanup)
        const numPlayers = this.multiplayerState?.numPlayers || 4;
        for (let i = 1; i <= numPlayers; i++) {
            const container = document.getElementById(`p${i}-phaser-container`);
            if (container) {
                const overlays = container.querySelectorAll('.player-death-overlay');
                overlays.forEach((overlay) => {
                    console.log(`[LocalMultiplayer] Force removing overlay from P${i} container`);
                    overlay.remove();
                });
            }
        }

        // Reset array
        this.deathOverlays = [];
        console.log('[LocalMultiplayer] Death animations cleared');
    }

    /**
     * Create simple gentle fade out elimination effect - covers entire player canvas
     * @private
     */
    _createEliminationExplosion(boardScene, playerIndex) {
        const playerNum = playerIndex + 1;
        console.log(`[LocalMultiplayer] Creating gentle fade out for Player ${playerNum}`);

        try {
            // Get the entire player container (includes board, stats, next pieces, etc.)
            const playerContainer = document.getElementById(`player${playerNum}-container`)
                || document.getElementById(`p${playerNum}-container`);

            if (!playerContainer) {
                console.warn(`[LocalMultiplayer] Player ${playerNum} container not found`);
                return;
            }

            // Create full-canvas fade overlay
            const fadeOverlay = document.createElement('div');
            fadeOverlay.className = 'elimination-fade-overlay';
            fadeOverlay.style.cssText = `
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: white;
                opacity: 0;
                z-index: 50;
                pointer-events: none;
                transition: opacity 0.6s ease-in-out;
            `;

            // Ensure container has position relative
            if (playerContainer.style.position !== 'relative' && playerContainer.style.position !== 'absolute') {
                playerContainer.style.position = 'relative';
            }

            playerContainer.appendChild(fadeOverlay);

            // Animate fade in
            requestAnimationFrame(() => {
                fadeOverlay.style.opacity = '0.8';
            });

            // Hold briefly then fade out
            setTimeout(() => {
                fadeOverlay.style.transition = 'opacity 0.4s ease-out';
                fadeOverlay.style.opacity = '0';

                // Remove overlay after fade completes
                setTimeout(() => {
                    if (fadeOverlay.parentElement) {
                        fadeOverlay.remove();
                    }
                }, 400);
            }, 800); // Hold for 800ms (600ms fade in + 200ms hold)

            // Also add camera flash to Phaser board if available
            if (boardScene && boardScene.cameras && boardScene.cameras.main) {
                boardScene.cameras.main.flash(400, 255, 255, 255, false);
            }

            console.log('[LocalMultiplayer] Full-canvas gentle fade out created successfully');
        } catch (error) {
            console.error('[LocalMultiplayer] Error creating elimination effect:', error);
        }
    }

    /**
     * Show victory animation for last player standing
     * @private
     */
    _showVictoryAnimation(winnerIndex) {
        const boardScene = this.boardScenes[winnerIndex];
        if (!boardScene || !boardScene.add) {
            console.warn('[LocalMultiplayer] Cannot create victory animation - scene not ready');
            return;
        }

        const PhaserRef = window.Phaser;
        if (!PhaserRef) {
            console.warn('[LocalMultiplayer] Phaser not available');
            return;
        }

        console.log(`[LocalMultiplayer] Showing victory animation for Player ${winnerIndex + 1}`);

        const width = boardScene.cols * boardScene.blockSize;
        const height = boardScene.rows * boardScene.blockSize;
        const particleKey = boardScene.commonParticleKey || 'common-circle-4px';

        try {
            // 1. GOLDEN FLASH
            if (boardScene.cameras && boardScene.cameras.main) {
                boardScene.cameras.main.flash(400, 255, 215, 0, false);
            }

            // 2. FIREWORKS - Multiple bursts
            if (boardScene.textures && boardScene.textures.exists(particleKey)) {
                const fireworkColors = [0xFFD700, 0xFFA500, 0xFF69B4, 0x00FF00, 0x00FFFF];

                // Launch 5 fireworks at different times and positions
                for (let i = 0; i < 5; i++) {
                    setTimeout(() => {
                        const x = (width * (0.2 + i * 0.15)) + (Math.random() - 0.5) * 30;
                        const y = height * (0.2 + Math.random() * 0.3);
                        const color = fireworkColors[i % fireworkColors.length];

                        // Firework burst
                        const firework = boardScene.add.particles(x, y, particleKey, {
                            speed: { min: 100, max: 200 },
                            angle: { min: 0, max: 360 },
                            scale: { start: 1.5, end: 0 },
                            tint: color,
                            lifespan: 1000,
                            gravityY: 150,
                            quantity: 30,
                            blendMode: 'ADD',
                        });

                        setTimeout(() => firework.destroy(), 1200);
                    }, i * 200);
                }

                // 3. CONTINUOUS CONFETTI from top
                const confetti = boardScene.add.particles(0, 0, particleKey, {
                    x: { min: 0, max: width },
                    y: -10,
                    speedY: { min: 100, max: 200 },
                    speedX: { min: -30, max: 30 },
                    scale: { start: 1.0, end: 0.5 },
                    tint: fireworkColors,
                    lifespan: 3000,
                    gravityY: 100,
                    frequency: 50,
                    blendMode: 'NORMAL',
                });

                // Stop confetti after 2.5 seconds
                setTimeout(() => {
                    confetti.stop();
                    setTimeout(() => confetti.destroy(), 3000);
                }, 2500);

                // 4. SPARKLE EFFECTS around the board
                for (let i = 0; i < 8; i++) {
                    setTimeout(() => {
                        const edge = Math.floor(Math.random() * 4);
                        let x; let
                            y;

                        switch (edge) {
                        case 0: x = Math.random() * width; y = 0; break; // Top
                        case 1: x = width; y = Math.random() * height; break; // Right
                        case 2: x = Math.random() * width; y = height; break; // Bottom
                        case 3: x = 0; y = Math.random() * height; break; // Left
                        }

                        const sparkle = boardScene.add.particles(x, y, particleKey, {
                            speed: { min: 50, max: 100 },
                            angle: { min: 0, max: 360 },
                            scale: { start: 1.0, end: 0 },
                            tint: 0xFFFFFF,
                            lifespan: 600,
                            quantity: 15,
                            blendMode: 'ADD',
                        });

                        setTimeout(() => sparkle.destroy(), 800);
                    }, i * 150);
                }
            }

            console.log('[LocalMultiplayer] Victory animation created successfully');
        } catch (error) {
            console.error('[LocalMultiplayer] Error creating victory animation:', error);
        }
    }
}
