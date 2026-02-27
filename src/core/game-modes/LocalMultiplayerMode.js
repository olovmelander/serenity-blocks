import Phaser from 'phaser';
import { BaseGameMode } from './BaseGameMode.js';
import { BoardJuice } from '../../rendering/phaser/board-juice.js';
import { MultiplayerGameState } from '../multiplayer.js';
import { MultiPlayerState, PLAYER_COLORS } from '../multi-player-state.js';
import { InfinityMinimap } from '../../ui/infinity/InfinityMinimap.js';
import {
    GAME_MODES, COLS, ROWS, BLOCK_SIZE,
} from '../constants.js';
import { spawnPiece, fillBag, processAutoDrop } from '../game.js';

import { expandGridIfNeeded, checkInfinityGameOver, calculateBuildHeight } from '../infinity-grid.js';
import { seededRandom } from '../../utils/helpers.js';
import { drawNextPieces } from '../../rendering/draw.js';
import { LocalMatchConfigModal } from '../../ui/local-match-config-modal.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';

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
        this.playerMinimaps = [];
        this.minimapCleanupHandlers = [];
        this.boardGap = 80; // Space between player boards

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
        this.teamRoundWins = { 0: 0, 1: 0 };

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

        // Initialize standings HUD
        this._initStandingsHUD();

        // Ensure UI is sized correctly before creating games
        this.onResize();

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
        gameArea.classList.remove('players-2', 'players-3', 'players-4', 'infinity-lms');

        // Add appropriate class for current player count
        gameArea.classList.add(`players-${numPlayers}`);

        // Add infinity class if needed
        if (this.matchConfig?.isInfinityLMS) {
            gameArea.classList.add('infinity-lms');
        }

        // Show/hide player cards and apply infinity class
        for (let i = 1; i <= 4; i++) {
            const playerCard = document.getElementById(`player-${i}-card`);
            if (playerCard) {
                if (i <= numPlayers) {
                    playerCard.style.display = this.matchConfig?.isInfinityLMS ? 'grid' : 'flex';
                    playerCard.removeAttribute('aria-hidden');

                    // Add infinity class to card
                    if (this.matchConfig?.isInfinityLMS) {
                        playerCard.classList.add('infinity-lms');
                    } else {
                        playerCard.classList.remove('infinity-lms');
                        const header = playerCard.querySelector('.player-header');
                        if (header) {
                            header.style.left = '';
                            header.style.transform = '';
                        }
                    }

                    // Add team marker if in team mode
                    if (this.matchConfig?.isTeamMode) {
                        const teamId = this._getResolvedTeamId(i - 1);
                        const teamName = teamId === 0 ? 'TEAM A' : 'TEAM B';
                        const teamColor = this._getTeamColorScheme(teamId).primary;

                        let teamMarker = playerCard.querySelector('.team-marker');
                        if (!teamMarker) {
                            teamMarker = document.createElement('div');
                            teamMarker.className = 'team-marker';
                            playerCard.appendChild(teamMarker);
                        }
                        teamMarker.textContent = teamName;
                        teamMarker.style.backgroundColor = teamColor;
                        teamMarker.style.color = 'white';
                        teamMarker.style.fontSize = '10px';
                        teamMarker.style.padding = '2px 6px';
                        teamMarker.style.borderRadius = '4px';
                        teamMarker.style.position = 'absolute';
                        teamMarker.style.top = '10px';
                        teamMarker.style.right = '10px';
                        teamMarker.style.fontWeight = 'bold';
                        teamMarker.style.zIndex = '10';
                    } else {
                        const teamMarker = playerCard.querySelector('.team-marker');
                        if (teamMarker) teamMarker.remove();
                    }
                } else {
                    playerCard.style.display = 'none';
                    playerCard.setAttribute('aria-hidden', 'true');
                }
            }
        }

        console.log(`[LocalMultiplayer] Layout updated for ${numPlayers} players${this.matchConfig?.isInfinityLMS ? ' (Infinity LMS mode)' : ''}`);
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

        // We deferred this mode start until config was confirmed, so resume
        // gameplay themes/music and dismiss the intro only at this point.
        if (this.deps.soundManager?.resumeThemeLinkedMusic) {
            this.deps.soundManager.resumeThemeLinkedMusic(true);
        }
        if (this.deps.themeManager?.resumeThemes) {
            await this.deps.themeManager.resumeThemes();
        }

        const { introAnimation } = await import('../../ui/intro-animation.js');
        if (introAnimation) {
            introAnimation.dismiss();
            await new Promise((resolve) => {
                setTimeout(resolve, 100);
            });
        }

        // Hide start modal immediately
        this.deps.modalManager.hideAll();

        // Clear any existing death animations (from previous match)
        this._clearDeathAnimations();

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
        this.teamRoundWins = { 0: 0, 1: 0 };

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

        // Sync scenes early so infinity cameras are configured before the first spawn
        this._syncBoardScenes();

        // Ensure stale minimaps are removed (e.g., rematch without deactivation)
        this._destroyMinimaps();

        // Initialize minimaps for Infinity Mode
        if (this.matchConfig?.isInfinityLMS) {
            console.log('[LocalMultiplayer] Initializing Infinity Minimaps...');
            const numPlayers = this.matchConfig?.numPlayers || 2;

            for (let i = 0; i < numPlayers; i++) {
                const playerNum = i + 1;
                const playerCard = document.getElementById(`player-${playerNum}-card`);

                if (playerCard) {
                    const minimap = new InfinityMinimap({
                        container: playerCard,
                        id: `infinity-minimap-p${playerNum}`,
                        width: 55,
                        height: 420,
                        maxRows: this.matchConfig?.infinityMaxRows || 100,
                    });

                    minimap.show();
                    this.playerMinimaps[i] = minimap;

                    // Setup exploration handlers
                    this._setupMinimapExploration(minimap, i);

                    console.log(`[LocalMultiplayer] Created minimap for Player ${playerNum}`);
                } else {
                    console.warn(`[LocalMultiplayer] Player card not found for Player ${playerNum}`);
                }
            }
        }

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
        this._updateMultiplayerStats(0);

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

        // Setup reactive board juice inputs
        this._setupInputWrappers();

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

        // Clean up BoardJuice
        for (let i = 1; i <= 4; i++) {
            if (this[`boardJuiceP${i}`]) {
                this[`boardJuiceP${i}`].destroy();
                this[`boardJuiceP${i}`] = null;
            }
        }

        // Restore global inputs
        this._removeInputWrappers();

        // Resume single player scene
        this._resumeSinglePlayerScene();

        // Hide standings HUD
        const standingsHud = document.getElementById('global-standings-hud');
        if (standingsHud) standingsHud.classList.add('hidden');
        this._hudItems = null;

        // Clean up state
        this.multiplayerState = null;
        this.boardScenes = [];

        // Clean up minimaps and minimap event listeners
        this._destroyMinimaps();

        // Clean up event listeners
        this._cleanupEventListeners(this.cleanupHandlers);
    }

    /**
     * Handle window resize
     */
    onResize() {
        // Recalculate block size based on new window dimensions
        const newBlockSize = this._calculateDynamicBlockSize();

        // Always update to ensure smooth resizing
        // if (this.currentBlockSize === newBlockSize) {
        //     return;
        // }

        console.log(`[LocalMultiplayer] onResize called. Current: ${this.currentBlockSize}, New: ${newBlockSize}`);
        this.currentBlockSize = newBlockSize;

        // Update CSS variables for UI - this controls the visual size of the container
        this._updateBoardCSSVariables(newBlockSize);

        // Force a DOM reflow so the browser recalculates element sizes
        // before Phaser checks the parent container dimensions
        const gameArea = document.querySelector('.multiplayer-game-area');
        if (gameArea) {
            // Reading offsetHeight forces a synchronous reflow
            void gameArea.offsetHeight;
        }

        // Phaser Scale.FIT will automatically handle the canvas scaling because the parent container size changed
        // Use requestAnimationFrame to ensure the DOM has fully updated before refreshing Phaser
        if (this.phaserGames && this.phaserGames.length > 0) {
            requestAnimationFrame(() => {
                this.phaserGames.forEach((game) => {
                    if (game && game.scale) {
                        game.scale.refresh();
                    }
                });
            });
        }
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

                // Skip players paused for minimap exploration
                if (this.multiplayerState.playerPaused?.[playerIndex]) {
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
                    // Check if grid expansion is needed
                    if (this.matchConfig?.isInfinityLMS && frameCount % 30 === 0) {
                        this._maybeExpandPlayerGrid(playerState, this.boardScenes[playerIndex]);
                    }
                    // Log before and after adding delta (first few frames)
                    if (frameCount <= 3) {
                        console.log(`[LocalMultiplayer] P${playerNum} BEFORE: dropCounter=${playerState.dropCounter}, delta=${delta}`);
                    }

                    // Use proper multiplayer callbacks (from main.js) to handle garbage and spawning
                    const callbacks = this.deps.getMultiplayerPhysicsCallbacks?.(playerNum)
                        || this._getPhysicsCallbacks();

                    processAutoDrop(
                        playerState,
                        delta,
                        () => this.deps.soundManager.sfxPlayer.playDrop(),
                        callbacks,
                    );

                    if (frameCount <= 3) {
                        console.log(`[LocalMultiplayer] P${playerNum} AFTER: dropCounter=${playerState.dropCounter}`);
                    }
                }

                if (this.matchConfig?.isInfinityLMS && !playerState.isGameOver) {
                    if (checkInfinityGameOver(playerState)) {
                        playerState.isGameOver = true;
                        void this._handleGameOver(playerIndex);
                        continue;
                    }
                }
            }

            // Update stats display
            this._updateMultiplayerStats(frameCount);

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
            onHardDrop: (dropData) => {
                this.deps.soundManager.sfxPlayer.playHardDrop();
                this.boardScenes.forEach((scene) => {
                    if (scene && scene.playHardDropEffect) {
                        scene.playHardDropEffect(dropData);
                    }
                });
            },
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
    /**
     * Update multiplayer stats display
     * @private
     * @param {number} frameCount - Current frame count for throttling
     */
    _updateMultiplayerStats(frameCount = 0) {
        if (!this.multiplayerState) {
            console.warn('[LocalMultiplayer] Cannot update stats: multiplayerState is null');
            return;
        }

        const { numPlayers } = this.multiplayerState;

        // Skip DOM updates most frames (run at ~6fps for text stats)
        // But ALWAYS update minimaps for smooth animation
        const shouldUpdateText = frameCount % 10 === 0;

        if (shouldUpdateText) {
            // Initialize previous values tracking if not exists
            if (!this._prevStats) {
                this._prevStats = {};
            }

            for (let i = 0; i < numPlayers; i++) {
                const playerNum = i + 1;
                const playerState = this.multiplayerState.players[i];
                if (!playerState) continue;

                const matchKey = `player${playerNum}`;
                const matchTotals = this.matchStats[matchKey] || {
                    score: 0,
                    lines: 0,
                    deaths: 0,
                };

                const totalScore = (matchTotals.score || 0) + (playerState.score || 0);
                const totalLines = (matchTotals.lines || 0) + (playerState.totalLinesCleared || 0);
                const totalLevel = playerState.level ?? 1;
                const totalGarbage = this.multiplayerState.garbageQueues?.[i]?.getTotalLines?.() ?? 0;
                const roundFrags = (matchTotals.frags || 0) + (this.multiplayerState.frags[i] ?? 0);

                // Fix: Sum match deaths + current round deaths
                const totalDeaths = (matchTotals.deaths || 0) + (this.multiplayerState.deaths?.[i] ?? 0);

                const fragsEl = document.getElementById(`p${playerNum}-frags`);
                const deathsEl = document.getElementById(`p${playerNum}-deaths`);
                const scoreEl = document.getElementById(`p${playerNum}-score`);
                const linesEl = document.getElementById(`p${playerNum}-lines`);
                const levelEl = document.getElementById(`p${playerNum}-level`);
                const garbageEl = document.getElementById(`p${playerNum}-garbage`);

                // Track previous values for pulse animation
                const prevKey = `p${playerNum}`;
                if (!this._prevStats[prevKey]) {
                    this._prevStats[prevKey] = {
                        frags: 0, deaths: 0, score: 0, lines: 0, level: 1, garbage: 0,
                    };
                }
                const prev = this._prevStats[prevKey];

                // Infinity LMS: Update Distance to Ceiling
                if (this.matchConfig?.isInfinityLMS) {
                    const ceilingContainerEl = document.getElementById(`p${playerNum}-ceiling-container`);
                    const ceilingEl = document.getElementById(`p${playerNum}-ceiling`);

                    if (ceilingContainerEl && ceilingEl) {
                        ceilingContainerEl.style.display = 'flex';

                        // Calculate distance to absolute ceiling
                        const buildHeight = calculateBuildHeight(playerState);
                        const distanceToCeiling = Math.max(0, (playerState.maxRows || 100) - buildHeight);

                        ceilingEl.textContent = distanceToCeiling;

                        // Initialize previous tracking for ceiling if needed
                        if (prev.ceiling === undefined) prev.ceiling = distanceToCeiling;

                        if (distanceToCeiling !== prev.ceiling) {
                            this._pulseElement(ceilingEl);
                            prev.ceiling = distanceToCeiling;
                        }
                    }
                } else {
                    // Hide if not in Infinity LMS mode
                    const ceilingContainerEl = document.getElementById(`p${playerNum}-ceiling-container`);
                    if (ceilingContainerEl) {
                        ceilingContainerEl.style.display = 'none';
                    }
                }

                // Update values with pulse animation if changed
                if (fragsEl) {
                    fragsEl.textContent = roundFrags;
                    if (roundFrags !== prev.frags) {
                        this._pulseElement(fragsEl);
                        prev.frags = roundFrags;
                    }
                }
                if (deathsEl) {
                    deathsEl.textContent = totalDeaths;
                    if (totalDeaths !== prev.deaths) {
                        this._pulseElement(deathsEl);
                        prev.deaths = totalDeaths;
                    }
                }
                if (scoreEl) {
                    scoreEl.textContent = this._formatStatValue(totalScore);
                    if (totalScore !== prev.score) {
                        this._pulseElement(scoreEl);
                        prev.score = totalScore;
                    }
                }
                if (linesEl) {
                    linesEl.textContent = totalLines;
                    if (totalLines !== prev.lines) {
                        this._pulseElement(linesEl);
                        prev.lines = totalLines;
                    }
                }
                if (levelEl) {
                    levelEl.textContent = totalLevel;
                    if (totalLevel !== prev.level) {
                        this._pulseElement(levelEl);
                        prev.level = totalLevel;
                    }
                }
                if (garbageEl) {
                    garbageEl.textContent = totalGarbage;
                    if (totalGarbage !== prev.garbage) {
                        this._pulseElement(garbageEl);
                        prev.garbage = totalGarbage;
                    }
                }

                // Update garbage indicator bar
                this._updateGarbageIndicator(playerNum, totalGarbage);
            }

            // Update board-level frag displays for all players (used in 3-4 player mode)
            for (let i = 1; i <= numPlayers; i++) {
                const boardFragDisplay = document.getElementById(`p${i}-board-frags`);
                if (boardFragDisplay) {
                    const playerKey = `player${i}`;
                    let displayVal = `${(this.matchStats[playerKey]?.frags || 0) + (this.multiplayerState.frags[i - 1] || 0)} F`;

                    // If team mode, show team total frags on the board
                    if (this.matchConfig?.isTeamMode) {
                        const teamId = this.matchConfig.playerTeams[i - 1];
                        let teamTotalFrags = 0;
                        for (let j = 0; j < numPlayers; j++) {
                            if (this.matchConfig.playerTeams[j] === teamId) {
                                teamTotalFrags += this.multiplayerState.frags[j];
                            }
                        }
                        displayVal = `${teamTotalFrags} TF`;
                    }

                    boardFragDisplay.textContent = displayVal;
                }
            }

            // Update top standings HUD
            this._updateStandingsHUD();
        }

        // Update minimaps for infinity mode
        if (this.matchConfig?.isInfinityLMS && this.playerMinimaps.length > 0) {
            this.playerMinimaps.forEach((minimap, index) => {
                if (!minimap) return;

                const playerState = this.multiplayerState.players[index];
                const scene = this.boardScenes[index];

                if (playerState && scene && scene.cameraSettings) {
                    const currentTopRow = scene.cameraSettings.currentTopRow || 0;
                    const visibleRows = scene.cameraSettings.visibleRows || 20;

                    minimap.update(playerState, currentTopRow, visibleRows);
                }
            });
        }
    }

    /**
     * Format a stat number with K/M suffixes for readability.
     * @private
     */
    _formatStatValue(n) {
        if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
        if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
        return String(n);
    }

    /**
     * Build the global standings HUD items (one per player).
     * Called once from _setupMultiplayerUI().
     * @private
     */
    _initStandingsHUD() {
        const hud = document.getElementById('global-standings-hud');
        if (!hud) return;

        const numPlayers = this.matchConfig?.numPlayers || 2;
        hud.innerHTML = '';
        this._hudItems = {};

        for (let i = 0; i < numPlayers; i++) {
            const playerNum = i + 1;
            const colorScheme = this._getPlayerColorScheme(i);
            const color = colorScheme?.primary || '#8b5cf6';

            const item = document.createElement('div');
            item.className = 'standing-item';
            item.dataset.player = playerNum;
            item.dataset.rank = playerNum;
            item.innerHTML = `
                <span class="rank-badge">${playerNum}</span>
                <span class="player-color-dot" style="background:${color};color:${color}"></span>
                <span class="player-name">P${playerNum}</span>
                <span class="player-score">0</span>
                <span class="player-meta">Lv1 · 0L</span>
            `;
            hud.appendChild(item);
            this._hudItems[i] = {
                el: item,
                rankEl: item.querySelector('.rank-badge'),
                scoreEl: item.querySelector('.player-score'),
                metaEl: item.querySelector('.player-meta'),
            };
        }

        hud.classList.remove('hidden');
    }

    /**
     * Returns sort key, primary value renderer, and meta renderer for the HUD
     * based on the active win condition.
     * @private
     */
    _getHUDProfile() {
        const ec = this.matchConfig?.endCondition || 'frags';
        const fmt = (n) => this._formatStatValue(n);

        const fragsIcon = `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-0.125em;margin-right:2px"><polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5"/><line x1="13" y1="19" x2="19" y2="13"/><line x1="16" y1="16" x2="20" y2="20"/><line x1="19" y1="21" x2="21" y2="19"/><polyline points="14.5 6.5 18 3 21 3 21 6 17.5 9.5"/><line x1="5" y1="11" x2="11" y2="5"/><line x1="3" y1="13" x2="5" y2="15"/><line x1="8" y1="8" x2="4" y2="12"/></svg>`;

        switch (ec) {
            case 'frags':
            case 'time':
                // Frags wins / time limit: most kills leads
                return {
                    sortKey: 'frags',
                    primaryFn: (e) => `${fragsIcon}${e.frags}`,
                    metaFn: (e) => `${fmt(e.score)} · Lv${e.level} · ${e.lines}L`,
                };
            case 'lines':
                // First to N lines: lines cleared leads
                return {
                    sortKey: 'lines',
                    primaryFn: (e) => `${e.lines}L`,
                    metaFn: (e) => `${fragsIcon}${e.frags} · ${fmt(e.score)} · Lv${e.level}`,
                };
            case 'infinity-lms':
                // Survival: alive status + lines cleared as tiebreak
                return {
                    sortKey: 'lines',
                    primaryFn: (e) => `${e.lines}L`,
                    metaFn: (e) => `Lv${e.level}`,
                };
            case 'points':
            case 'never':
            default:
                // Score-based / endless: score leads
                return {
                    sortKey: 'score',
                    primaryFn: (e) => fmt(e.score),
                    metaFn: (e) => `${fragsIcon}${e.frags} · Lv${e.level} · ${e.lines}L`,
                };
        }
    }

    /**
     * Update the global standings HUD with live player data, sorted by the
     * active win condition stat.
     * Called inside the shouldUpdateText throttle in _updateMultiplayerStats().
     * @private
     */
    _updateStandingsHUD() {
        const hud = document.getElementById('global-standings-hud');
        if (!hud || !this.multiplayerState || !this._hudItems) return;

        const { numPlayers } = this.multiplayerState;
        const trophySvg = (color) => `<svg viewBox="0 0 24 24" width="1.2em" height="1.2em" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-0.2em"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg>`;
        const RANK_LABELS = [trophySvg('#FFF480'), trophySvg('#E2E8F0'), trophySvg('#CD7F32'), '4th'];
        const { sortKey, primaryFn, metaFn } = this._getHUDProfile();

        // Build standings array from live state
        const standings = [];
        for (let i = 0; i < numPlayers; i++) {
            const playerState = this.multiplayerState.players[i];
            if (!playerState) continue;
            const matchKey = `player${i + 1}`;
            const matchTotals = this.matchStats[matchKey] || {};
            standings.push({
                playerIndex: i,
                score: (matchTotals.score || 0) + (playerState.score || 0),
                level: playerState.level ?? 1,
                lines: (matchTotals.lines || 0) + (playerState.totalLinesCleared || 0),
                frags: (matchTotals.frags || 0) + (this.multiplayerState.frags[i] ?? 0),
                isAlive: playerState.isAlive !== false,
            });
        }

        // Sort: alive players by the win-condition stat descending, eliminated last
        standings.sort((a, b) => {
            if (a.isAlive !== b.isAlive) return a.isAlive ? -1 : 1;
            return b[sortKey] - a[sortKey];
        });

        standings.forEach((entry, rankIndex) => {
            const refs = this._hudItems[entry.playerIndex];
            if (!refs) return;
            const { el, rankEl, scoreEl, metaEl } = refs;

            rankEl.innerHTML = RANK_LABELS[rankIndex] ?? `${rankIndex + 1}`;
            el.dataset.rank = rankIndex + 1;
            scoreEl.innerHTML = entry.isAlive ? primaryFn(entry) : 'ELIM';
            metaEl.innerHTML = entry.isAlive ? metaFn(entry) : '';
            el.classList.toggle('standing-item--eliminated', !entry.isAlive);

            // Re-appending reorders DOM nodes to match sorted standings
            hud.appendChild(el);
        });
    }

    /**
     * Add pulse animation to an element
     * @private
     */
    _pulseElement(element) {
        if (!element) return;
        element.classList.remove('pulse');
        // Trigger reflow to restart animation
        void element.offsetWidth;
        element.classList.add('pulse');
    }

    /**
     * Update garbage indicator bar for a player
     * @private
     */
    _updateGarbageIndicator(playerNum, garbageAmount) {
        const garbageBar = document.getElementById(`p${playerNum}-garbage-bar`);
        if (!garbageBar) return;

        const fill = garbageBar.querySelector('.garbage-fill');
        const glow = garbageBar.querySelector('.garbage-glow');

        // Calculate percentage (max 20 rows = 100%)
        const maxGarbage = 20;
        const percentage = Math.min((garbageAmount / maxGarbage) * 100, 100);

        if (fill) {
            fill.style.height = `${percentage}%`;
        }
        if (glow) {
            glow.style.height = `${percentage}%`;
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

            // Update camera for infinity mode
            if (playerState.isInfinityMode && scene && scene.cameraSettings) {
                this._updatePlayerCamera(scene, playerState, index);
            }
        });
    }

    _updatePlayerCamera(scene, playerState, playerIndex) {
        // Skip if manually controlled (exploration mode)
        if (scene.cameraSettings.manualControl) {
            return;
        }

        // Skip if player is paused for exploration
        if (this.multiplayerState.playerPaused && this.multiplayerState.playerPaused[playerIndex]) {
            return;
        }

        const visibleRows = scene.cameraSettings.visibleRows || 20;
        const board = playerState.boardGrid || playerState.board;
        if (!board) {
            return;
        }
        const { currentPiece } = playerState;

        if (currentPiece) {
            // Follow piece if it goes below 50% of viewport
            const pieceBottomRow = currentPiece.y + (currentPiece.shape ? currentPiece.shape.length : 0);
            const currentCameraRow = scene.cameraSettings.currentTopRow;
            const followThreshold = currentCameraRow + Math.floor(visibleRows * 0.5);

            if (pieceBottomRow > followThreshold) {
                // Follow piece downward
                const targetCameraRow = pieceBottomRow - Math.floor(visibleRows * 0.5);
                const maxCameraRow = Math.max(0, board.length - visibleRows);
                const clampedCameraRow = Math.max(0, Math.min(maxCameraRow, targetCameraRow));

                scene.updateCameraPosition(clampedCameraRow);
                return;
            }
        }

        // Follow building upward when blocks reach top 30% of viewport
        const highestBlockRow = this._findHighestBlockRow(board);
        if (highestBlockRow < board.length) {
            const currentCameraRow = scene.cameraSettings.currentTopRow;
            const scrollThreshold = currentCameraRow + Math.floor(visibleRows * 0.3);

            if (highestBlockRow < scrollThreshold) {
                const targetCameraRow = highestBlockRow - Math.floor(visibleRows * 0.3);
                const maxCameraRow = Math.max(0, board.length - visibleRows);
                const clampedCameraRow = Math.max(0, Math.min(maxCameraRow, targetCameraRow));

                scene.updateCameraPosition(clampedCameraRow);
            }
        }
    }

    _findHighestBlockRow(board) {
        for (let row = 0; row < board.length; row++) {
            for (let col = 0; col < board[row].length; col++) {
                if (board[row][col] !== null) {
                    return row;
                }
            }
        }
        return board.length;
    }

    _maybeExpandPlayerGrid(playerState, scene) {
        if (!playerState?.isInfinityMode || !scene?.cameraSettings) {
            return;
        }

        if (scene.cameraSettings.manualControl) {
            return;
        }

        const board = playerState.boardGrid || playerState.board;
        if (!board || board.length >= playerState.maxRows) {
            return;
        }

        const highestBlockRow = this._findHighestBlockRow(board);
        const EXPANSION_THRESHOLD = 30;
        if (highestBlockRow > EXPANSION_THRESHOLD) {
            return;
        }

        const currentSize = board.length;
        const requiredRows = Math.min(playerState.maxRows, currentSize + 10);
        const oldCameraRow = scene.cameraSettings.currentTopRow || 0;
        const oldTargetRow = scene.cameraSettings.targetTopRow ?? oldCameraRow;

        if (!expandGridIfNeeded(playerState, requiredRows)) {
            return;
        }

        const expandedBoard = playerState.boardGrid || playerState.board;
        const rowsAdded = expandedBoard.length - currentSize;
        if (rowsAdded <= 0) {
            return;
        }

        scene.updateCameraBounds();

        const newCameraRow = oldCameraRow + rowsAdded;
        const newTargetRow = oldTargetRow + rowsAdded;

        scene.cameraSettings.currentTopRow = newCameraRow;
        scene.cameraSettings.activeTopRow = newCameraRow;
        scene.cameraSettings.targetTopRow = newTargetRow;

        const visibleRows = scene.cameraSettings.visibleRows || 20;
        scene.cameraSettings.centerRow = newCameraRow + visibleRows / 2;
        const blockSize = scene.boardConfig?.blockSize || BLOCK_SIZE;
        const centerY = newCameraRow * blockSize + (visibleRows * blockSize) / 2;
        const { width } = scene.getBoardDimensions();
        scene.cameras?.main?.centerOn(width / 2, centerY);

        playerState.cameraRow = newCameraRow;
        playerState.cameraCenterRow = newCameraRow + visibleRows / 2;

        if (playerState.infinityStats) {
            playerState.infinityStats.rowsReached = Math.max(
                playerState.infinityStats.rowsReached || 0,
                expandedBoard.length,
            );
        }
    }

    _destroyMinimaps() {
        this._cleanupEventListeners(this.minimapCleanupHandlers);
        this.minimapCleanupHandlers = [];

        if (this.playerMinimaps.length > 0) {
            this.playerMinimaps.forEach((minimap) => {
                if (minimap) {
                    minimap.destroy();
                }
            });
            this.playerMinimaps = [];
        }
    }

    _setupMinimapExploration(minimap, playerIndex) {
        const playerNum = playerIndex + 1;

        // Exploration start
        const startHandler = () => {
            console.log(`[LocalMP] Player ${playerNum} exploration started`);

            // Allow this player to pause for exploration
            // Initialize playerPaused array if not exists
            if (!this.multiplayerState.playerPaused) {
                this.multiplayerState.playerPaused = new Array(this.multiplayerState.numPlayers).fill(false);
            }
            this.multiplayerState.playerPaused[playerIndex] = true;

            if (this.boardScenes[playerIndex]) {
                this.boardScenes[playerIndex].enableManualCameraControl();
            }

            minimap.onPause();
        };

        // Exploration end
        const endHandler = () => {
            console.log(`[LocalMP] Player ${playerNum} exploration ended`);

            if (this.multiplayerState.playerPaused) {
                this.multiplayerState.playerPaused[playerIndex] = false;
            }

            if (this.boardScenes[playerIndex]) {
                const scene = this.boardScenes[playerIndex];
                scene.disableManualCameraControl();

                // Snap back to gameplay position (show active piece)
                const playerState = this.multiplayerState.players[playerIndex];
                const cameraRow = this._calculateGameplayCameraPosition(playerState);
                scene.updateCameraPosition(cameraRow);
            }

            minimap.onUnpause();
        };

        // Camera jump during exploration
        const jumpHandler = (event) => {
            if (this.boardScenes[playerIndex]) {
                const { targetRow } = event.detail;
                const scene = this.boardScenes[playerIndex];
                const visibleRows = scene.cameraSettings?.visibleRows || 20;

                // Calculate top row (center target in viewport)
                const targetTopRow = targetRow - Math.floor(visibleRows / 2);
                const maxCameraRow = Math.max(0, this.multiplayerState.players[playerIndex].board.length - visibleRows);
                const clampedRow = Math.max(0, Math.min(maxCameraRow, targetTopRow));

                scene.updateCameraPosition(clampedRow, true); // Immediate update
            }
        };

        // Add event listeners
        minimap.container.addEventListener('minimap-exploration-start', startHandler);
        minimap.container.addEventListener('minimap-exploration-end', endHandler);
        minimap.container.addEventListener('minimap-jump', jumpHandler);

        // Store for cleanup
        this.minimapCleanupHandlers.push(() => {
            minimap.container.removeEventListener('minimap-exploration-start', startHandler);
            minimap.container.removeEventListener('minimap-exploration-end', endHandler);
            minimap.container.removeEventListener('minimap-jump', jumpHandler);
        });
    }

    _calculateGameplayCameraPosition(playerState) {
        const visibleRows = 20;
        const board = playerState.boardGrid || playerState.board;
        const totalRows = board ? board.length : visibleRows;
        const maxCameraRow = Math.max(0, totalRows - visibleRows);

        // Center on active piece
        if (playerState.currentPiece) {
            const pieceBottomRow = playerState.currentPiece.y + (playerState.currentPiece.shape?.length || 0);
            const targetRow = pieceBottomRow - Math.floor(visibleRows * 0.5);
            return Math.max(0, Math.min(maxCameraRow, targetRow));
        }

        // Fallback: show highest blocks
        const highestRow = board ? this._findHighestBlockRow(board) : totalRows;
        if (highestRow < totalRows) {
            const targetRow = highestRow - Math.floor(visibleRows * 0.3);
            return Math.max(0, Math.min(maxCameraRow, targetRow));
        }

        return maxCameraRow;
    }

    /**
     * Handle game over for a player
     * @private
     */
    async _handleGameOver(playerIndex) {
        console.log(`[LocalMultiplayer] Player ${playerIndex + 1} lost!`);

        // Check if this was a suicide (no attacker) BEFORE handling death (which might clear state)
        // MultiPlayerState.handlePlayerDeath uses the same logic to log, but we need it here for round logic
        const killerId = this.multiplayerState.lastAttackerIds[playerIndex];
        const isSelfKill = killerId === null || killerId === playerIndex;

        if (isSelfKill) {
            console.log(`[LocalMultiplayer] Player ${playerIndex + 1} self-destructed (self-kill). No frag awarded.`);
        }

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

        // === INFINITY LMS LOGIC ===
        if (this.matchConfig?.isInfinityLMS) {
            console.log('[LocalMultiplayer] Checking Infinity LMS win conditions...');

            // Team Mode Check
            if (this.matchConfig?.isTeamMode) {
                const teamOutcome = this._getTeamRoundOutcome();
                // We only care if a team has WON (other teams eliminated), not draws yet unless everyone died
                if (teamOutcome && teamOutcome.winnerTeamId !== null) {
                    this.multiplayerState.isPaused = true;

                    const winningPlayers = teamOutcome.teamStats.get(teamOutcome.winnerTeamId)?.alivePlayers || [];
                    console.log(`[LocalMultiplayer] Infinity Team Victory! Team ${teamOutcome.winnerTeamId} wins.`);

                    // Show victory for all survivors
                    winningPlayers.forEach((winnerIndex) => {
                        this._showVictoryAnimation(winnerIndex);
                    });

                    // Direct to match end
                    await new Promise((resolve) => setTimeout(resolve, 1000)); // Short pause for effect
                    await this._showMatchEnd({ type: 'team', teamId: teamOutcome.winnerTeamId });
                    return;
                }

                // If everyone died (draw), handle it
                if (teamOutcome && teamOutcome.isDraw) {
                    console.log('[LocalMultiplayer] Infinity Draw (all teams eliminated)');
                    await new Promise((resolve) => setTimeout(resolve, 1000));
                    // Use specific draw message or just end match with no winner?
                    // For now, let's just end it as a draw
                    await this._showMatchEnd('draw');
                    return;
                }

                // If match continues...
                return;
            }

            // FFA Check (2-4 players)
            const alivePlayers = this.multiplayerState.players.filter((p) => p.isAlive);
            if (alivePlayers.length <= 1) {
                this.multiplayerState.isPaused = true;

                let winnerKey = null;
                if (alivePlayers.length === 1) {
                    // Find the actual index of the survivor
                    const winnerIndex = this.multiplayerState.players.findIndex((p) => p.isAlive);
                    winnerKey = `player${winnerIndex + 1}`;
                    console.log(`[LocalMultiplayer] Infinity FFA Victory! Player ${winnerIndex + 1} wins.`);
                    this._showVictoryAnimation(winnerIndex);
                } else {
                    console.log('[LocalMultiplayer] Infinity FFA Draw (all players eliminated)');
                    // Handle draw case
                    winnerKey = 'draw';
                }

                await new Promise((resolve) => setTimeout(resolve, 1000));
                await this._showMatchEnd(winnerKey);
                return;
            }

            // Game continues
            return;
        }

        // === STANDARD MODE LOGIC ===
        if (this.matchConfig?.isTeamMode) {
            const teamOutcome = this._getTeamRoundOutcome();
            if (!teamOutcome) {
                return;
            }

            // Round ends when a team is fully eliminated
            this.multiplayerState.isPaused = true;

            if (!teamOutcome.isDraw && teamOutcome.winnerTeamId !== null) {
                const winningPlayers = teamOutcome.teamStats.get(teamOutcome.winnerTeamId)?.alivePlayers || [];
                winningPlayers.forEach((winnerIndex) => {
                    this._showVictoryAnimation(winnerIndex);
                });

                await new Promise((resolve) => setTimeout(resolve, 500));
                await this.handleRoundEnd({ type: 'team', teamId: teamOutcome.winnerTeamId });
            } else {
                console.log('[LocalMultiplayer] Round ended in a draw (no teams remaining)');
                await new Promise((resolve) => setTimeout(resolve, 500));
                await this._startNewRound();
            }
            return;
        }

        // For 2 players, determine winner immediately and pause
        if (this.multiplayerState.numPlayers === 2) {
            // ONLY pause when round ends (2 players)
            this.multiplayerState.isPaused = true;
            const winnerIndex = playerIndex === 0 ? 1 : 0;
            const winnerKey = `player${winnerIndex + 1}`;

            // Show victory animation for the winner
            this._showVictoryAnimation(winnerIndex);

            // Wait for victory animation before showing round end
            await new Promise((resolve) => setTimeout(resolve, 500));

            // Pass isSelfKill flag to handleRoundEnd
            await this.handleRoundEnd(winnerKey, isSelfKill);
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
                    await new Promise((resolve) => setTimeout(resolve, 500));

                    await this.handleRoundEnd(winnerKey, isSelfKill);
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
            const count = 5;

            // Create overlay background
            const overlay = document.createElement('div');
            overlay.id = 'countdown-overlay';
            // ... (rest of function - ensuring I don't cut it off, but I need to jump to handleRoundEnd)
            // Wait, I am replacing a huge chunk including _handleGameOver.
            // I need to make sure I don't delete _showCountdown or handleRoundEnd if I don't include them in replacement.
            // The tool `replace_file_content` replaces a contiguous block.
            // My previous `view_file` showed `_showCountdown` starting at 1393.
            // `_handleGameOver` starts at 1241 and ends around 1387.
            // `handleRoundEnd` is way down at 2260.
            // I should use `multi_replace_file_content` because I'm editing two separate functions that are far apart.
            // I cannot use `replace_file_content` for both effectively without reading the whole file in between.
            // I will ABORT this `replace_file_content` and use `multi_replace_file_content`.
        });
    }

    // Placeholder to make valid JS for thought process - I will return error to myself to switch tools.

    /**
     * Show countdown before game starts
     * @private
     */
    async _showCountdown() {
        console.log('[LocalMultiplayer] Starting countdown...');
        return new Promise((resolve) => {
            let count = 5;

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
     * Calculate dynamic block size based on window height
     * @private
     */
    _calculateDynamicBlockSize() {
        const windowHeight = window.innerHeight;
        const windowWidth = window.innerWidth;
        const numPlayers = this.matchConfig?.numPlayers || 2;
        const isInfinity = this.matchConfig?.isInfinityLMS;

        if (isInfinity) {
            // Infinity mode: prioritize vertical space for 20 visible rows
            const maxHeight = windowHeight * 0.80; // Use 80% of viewport height
            const visibleRows = 20; // Standard infinity viewport

            // Calculate block size from height constraint
            const blockSizeByHeight = Math.floor(maxHeight / visibleRows);

            // Calculate block size from width constraint
            // We need to account for UI overhead in the layout:
            // - Minimap column: ~65px
            // - Minimap gap: ~8px
            // - Card padding: ~28px total
            // - Card borders: ~6px total
            // - Garbage bar + gap: ~14px
            // - Grid gaps: Between players (handled separately)
            // - Global screen padding: ~100px total

            const perPlayerFixedOverhead = 65 + 8 + 28 + 6 + 14;
            const totalFixedOverhead = (perPlayerFixedOverhead * numPlayers) + 100;

            const baseGap = numPlayers === 2 ? 40 : numPlayers === 3 ? 30 : 20;
            const gapWidth = baseGap * (numPlayers - 1);

            const availableWidthForBoards = windowWidth - totalFixedOverhead - gapWidth;
            const boardWidthPerPlayer = availableWidthForBoards / numPlayers;
            const blockSizeByWidth = Math.floor(boardWidthPerPlayer / COLS);

            // Use smaller of the two to ensure fit
            const blockSize = Math.min(blockSizeByHeight, blockSizeByWidth);

            // Clamp to playable range (smaller than normal multiplayer)
            const clampedSize = Math.max(12, Math.min(32, blockSize));

            console.log(`[LocalMultiplayer] Infinity Mode Sizing:
                Window: ${windowWidth}x${windowHeight}
                Block size by height (${visibleRows} rows): ${blockSizeByHeight}px
                Block size by width (${numPlayers} players): ${blockSizeByWidth}px
                Final size: ${clampedSize}px
            `);

            return clampedSize;
        }

        // Normal multiplayer mode
        // Height constraint
        // Fixed elements: top/bottom screen padding (40px each), player label (~30px),
        // stats section (~50px), card padding (~30px), bottom gap (~30px)
        // +60px for standings HUD pill (always shown in all player counts)
        const fixedVerticalSpace = 280;
        const availableHeight = windowHeight - fixedVerticalSpace;

        // The next pieces also scale with blockSize (~2.5 blocks tall including padding)
        // So effective height = ROWS * blockSize + 2.5 * blockSize = (ROWS + 2.5) * blockSize
        const effectiveRows = ROWS + 2.5;
        const sizeByHeight = availableHeight / effectiveRows;

        // Width constraint
        const cardPadding = 40;
        const gapSize = 60;
        const outerPadding = 80;

        const totalFixedHorizontalSpace = (numPlayers * cardPadding) + ((numPlayers - 1) * gapSize) + outerPadding;
        const availableWidth = windowWidth - totalFixedHorizontalSpace;
        const totalCols = numPlayers * COLS;
        const sizeByWidth = availableWidth / totalCols;

        // Take the smaller of the two to ensure it fits both dimensions
        let size = Math.min(sizeByHeight, sizeByWidth);

        console.log(`[LocalMultiplayer] Sizing Debug:
            Window: ${windowWidth}x${windowHeight}
            Available Height: ${availableHeight} (Fixed: ${fixedVerticalSpace}, EffectiveRows: ${effectiveRows}) -> Size: ${sizeByHeight}
            Available Width: ${availableWidth} (Fixed: ${totalFixedHorizontalSpace}) -> Size: ${sizeByWidth}
            Raw Size: ${size}
        `);

        // Clamp size between reasonable min and max
        // Min 10px allows for very small screens
        // Max 80px allows for large screens (4K)
        size = Math.max(10, Math.min(80, size));

        console.log(`[LocalMultiplayer] Calculated block size: ${size}px (Window: ${windowWidth}x${windowHeight}, Players: ${numPlayers})`);
        return size;
    }

    /**
     * Update CSS variables for board dimensions
     * @private
     */
    _updateBoardCSSVariables(blockSize) {
        const boardWidth = COLS * blockSize;
        const boardHeight = ROWS * blockSize;

        // Dynamic gap: 1.5 blocks, clamped between 20px and 80px
        const dynamicGap = Math.max(20, Math.min(80, blockSize * 1.5));

        // Next piece sizes: scale proportionally with block size
        // Highlight piece: ~2.2 blocks, clamped between 44px and 100px
        const nextPieceHighlightSize = Math.max(44, Math.min(100, blockSize * 2.2));
        // Regular pieces: ~1.9 blocks, clamped between 38px and 86px
        const nextPieceSize = Math.max(38, Math.min(86, blockSize * 1.9));
        // Gap between next pieces: ~0.25 blocks, clamped between 4px and 12px
        const nextPieceGap = Math.max(4, Math.min(12, blockSize * 0.25));

        console.log(`[LocalMultiplayer] Updating CSS variables: width=${boardWidth}px, height=${boardHeight}px, gap=${dynamicGap}px, nextPiece=${nextPieceSize}px`);

        // Set globally on root to ensure all elements pick it up
        document.documentElement.style.setProperty('--board-width', `${boardWidth}px`);
        document.documentElement.style.setProperty('--board-height', `${boardHeight}px`);
        document.documentElement.style.setProperty('--board-gap', `${dynamicGap}px`);
        document.documentElement.style.setProperty('--next-piece-size', `${nextPieceSize}px`);
        document.documentElement.style.setProperty('--next-piece-highlight-size', `${nextPieceHighlightSize}px`);
        document.documentElement.style.setProperty('--next-piece-gap', `${nextPieceGap}px`);

        // Also set on specific containers as fallback
        const gameArea = document.querySelector('.multiplayer-game-area');
        if (gameArea) {
            gameArea.style.setProperty('--board-width', `${boardWidth}px`);
            gameArea.style.setProperty('--board-height', `${boardHeight}px`);
            gameArea.style.setProperty('--board-gap', `${dynamicGap}px`);
        }

        const playerCards = document.querySelectorAll('.player-card');
        playerCards.forEach((card) => {
            card.style.setProperty('--board-width', `${boardWidth}px`);
            card.style.setProperty('--board-height', `${boardHeight}px`);
            card.style.setProperty('--next-piece-size', `${nextPieceSize}px`);
            card.style.setProperty('--next-piece-highlight-size', `${nextPieceHighlightSize}px`);
            card.style.setProperty('--next-piece-gap', `${nextPieceGap}px`);
        });
    }

    /**
     * Ensure multiplayer board scenes exist
     * @private
     */
    async _ensureMultiplayerBoardScenes(forceRestart = false) {
        const { phaserGame } = this.deps;
        const MultiplayerBoardSceneClass = this.deps.phaserGame?.MultiplayerBoardSceneClass;

        if (!phaserGame || !MultiplayerBoardSceneClass) {
            throw new Error('Phaser game or MultiplayerBoardScene class not available');
        }

        // Check if scenes already exist
        let scene1 = phaserGame.scene?.getScene('BoardPanel1');
        let scene2 = phaserGame.scene?.getScene('BoardPanel2');

        // If scenes don't exist or we're forcing a restart, create/recreate them
        if (!scene1 || !scene2 || forceRestart) {
            console.log('[LocalMultiplayer] Creating board panel scenes...');

            // Calculate viewport dimensions
            // Calculate viewport dimensions
            const blockSize = this._calculateDynamicBlockSize();
            const singleBoardWidth = COLS * blockSize;
            const boardHeight = ROWS * blockSize;

            // Update CSS variables
            this._updateBoardCSSVariables(blockSize);

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
            const scene1Instance = new MultiplayerBoardSceneClass('BoardPanel1', { blockSize });
            const scene2Instance = new MultiplayerBoardSceneClass('BoardPanel2', { blockSize });

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
            // Calculate viewport dimensions
            const blockSize = this._calculateDynamicBlockSize();
            const singleBoardWidth = COLS * blockSize;
            const boardHeight = ROWS * blockSize;

            // Update CSS variables
            this._updateBoardCSSVariables(blockSize);

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
        // Calculate dynamic block size
        const blockSize = this._calculateDynamicBlockSize();
        this.currentBlockSize = blockSize;
        console.log(`[LocalMultiplayer] Using dynamic block size: ${blockSize} px`);

        // Update CSS variables immediately
        this._updateBoardCSSVariables(blockSize);

        // Game configuration for each player
        // Use a fixed internal resolution based on standard 40px blocks
        // This ensures all drawing logic (tetrominos, effects) works as designed
        const FIXED_BLOCK_SIZE = 40;
        const internalWidth = COLS * FIXED_BLOCK_SIZE;
        const internalHeight = ROWS * FIXED_BLOCK_SIZE;

        const createGameConfig = (parent) => ({
            width: internalWidth,
            height: internalHeight,
            parent,
            type: Phaser.WEBGL,
            transparent: true,
            audio: { noAudio: true },
            banner: false,
            fps: { target: 60 },
            scale: {
                mode: Phaser.Scale.FIT, // Scale the canvas to fit the parent container
                autoCenter: Phaser.Scale.CENTER_BOTH,
                width: internalWidth,
                height: internalHeight,
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
            const sceneKey = `P${i}Board`; // Removed space
            // Pass FIXED_BLOCK_SIZE so the scene draws at internal resolution
            const boardScene = new BoardScene(sceneKey, { blockSize: FIXED_BLOCK_SIZE });
            phaserGame.scene.add(sceneKey, boardScene, true);
            console.log(`[LocalMultiplayer] Player ${i} scene created: `, boardScene.scene?.key);

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

        // Initialize BoardJuice for each player's canvas
        this._initBoardJuice();

        console.log(`[LocalMultiplayer] ${numPlayers} Phaser instances created successfully`);
    }

    /**
     * Initialize BoardJuice for reactive board motion on each player's canvas
     * @private
     */
    _initBoardJuice() {
        for (let i = 1; i <= 4; i++) {
            if (this[`boardJuiceP${i}`]) {
                this[`boardJuiceP${i}`].destroy();
                this[`boardJuiceP${i}`] = null;
            }

            const container = document.getElementById(`p${i}-phaser-container`);
            const section = container?.closest('.player-board-section');
            if (section) {
                this[`boardJuiceP${i}`] = new BoardJuice(section);
            }
        }
    }

    /**
     * Wrap global input handlers to trigger board juice per player
     * @private
     */
    _setupInputWrappers() {
        if (this._inputWrappersSetup) return;
        this._inputWrappersSetup = true;

        this._originalInputs = {
            move: window.move, rotate: window.rotate, hardDrop: window.hardDrop,
            moveP2: window.moveP2, rotateP2: window.rotateP2, hardDropP2: window.hardDropP2,
            moveP3: window.moveP3, rotateP3: window.rotateP3, hardDropP3: window.hardDropP3,
            moveP4: window.moveP4, rotateP4: window.rotateP4, hardDropP4: window.hardDropP4,
        };

        const wrapMove = (playerNum, origMove) => (dir) => {
            if (origMove) origMove(dir);
            const juice = this[`boardJuiceP${playerNum}`];
            if (juice) {
                juice.nudge(dir * 0.5, 0);
            }
        };

        const wrapRotate = (playerNum, origRotate) => (dir) => {
            if (origRotate) origRotate(dir);
            const juice = this[`boardJuiceP${playerNum}`];
            if (juice) {
                const degrees = (dir === 'left' ? -1 : (dir === 'flip' ? 2 : 1));
                juice.tilt(degrees * 1.5);
                juice.nudge(0, -0.5);
            }
        };

        const wrapHardDrop = (playerNum, origHardDrop) => () => {
            if (origHardDrop) origHardDrop();
            const juice = this[`boardJuiceP${playerNum}`];
            if (juice) {
                juice.dip(4);
                juice.bounce();
            }
        };

        window.move = wrapMove(1, this._originalInputs.move);
        window.rotate = wrapRotate(1, this._originalInputs.rotate);
        window.hardDrop = wrapHardDrop(1, this._originalInputs.hardDrop);

        if (this._originalInputs.moveP2) window.moveP2 = wrapMove(2, this._originalInputs.moveP2);
        if (this._originalInputs.rotateP2) window.rotateP2 = wrapRotate(2, this._originalInputs.rotateP2);
        if (this._originalInputs.hardDropP2) window.hardDropP2 = wrapHardDrop(2, this._originalInputs.hardDropP2);

        if (this._originalInputs.moveP3) window.moveP3 = wrapMove(3, this._originalInputs.moveP3);
        if (this._originalInputs.rotateP3) window.rotateP3 = wrapRotate(3, this._originalInputs.rotateP3);
        if (this._originalInputs.hardDropP3) window.hardDropP3 = wrapHardDrop(3, this._originalInputs.hardDropP3);

        if (this._originalInputs.moveP4) window.moveP4 = wrapMove(4, this._originalInputs.moveP4);
        if (this._originalInputs.rotateP4) window.rotateP4 = wrapRotate(4, this._originalInputs.rotateP4);
        if (this._originalInputs.hardDropP4) window.hardDropP4 = wrapHardDrop(4, this._originalInputs.hardDropP4);
    }

    /**
     * Restore global input handlers
     * @private
     */
    _removeInputWrappers() {
        if (!this._originalInputs) return;

        window.move = this._originalInputs.move;
        window.rotate = this._originalInputs.rotate;
        window.hardDrop = this._originalInputs.hardDrop;

        if (this._originalInputs.moveP2 !== undefined) window.moveP2 = this._originalInputs.moveP2;
        if (this._originalInputs.rotateP2 !== undefined) window.rotateP2 = this._originalInputs.rotateP2;
        if (this._originalInputs.hardDropP2 !== undefined) window.hardDropP2 = this._originalInputs.hardDropP2;

        if (this._originalInputs.moveP3 !== undefined) window.moveP3 = this._originalInputs.moveP3;
        if (this._originalInputs.rotateP3 !== undefined) window.rotateP3 = this._originalInputs.rotateP3;
        if (this._originalInputs.hardDropP3 !== undefined) window.hardDropP3 = this._originalInputs.hardDropP3;

        if (this._originalInputs.moveP4 !== undefined) window.moveP4 = this._originalInputs.moveP4;
        if (this._originalInputs.rotateP4 !== undefined) window.rotateP4 = this._originalInputs.rotateP4;
        if (this._originalInputs.hardDropP4 !== undefined) window.hardDropP4 = this._originalInputs.hardDropP4;

        this._originalInputs = null;
        this._inputWrappersSetup = false;
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
                console.log(`[LocalMultiplayer] Removing scene: ${key} `);

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
        const numPlayers = this.matchConfig?.numPlayers || 2;
        console.log(`[LocalMultiplayer] Activating Phaser UI for ${numPlayers} players`);

        // Restore the body class for global CSS styling
        document.body.classList.add('phaser-multiplayer-active');

        // Force container visibility via JS (nuclear option to ensure it appears)
        const container = document.getElementById('multiplayer-container');
        if (container) {
            container.style.display = 'flex';
            container.style.visibility = 'visible';
            container.style.opacity = '1';
            container.style.zIndex = '1000';
            container.style.position = 'fixed';
            container.style.top = '0';
            container.style.left = '0';
            container.style.width = '100vw';
            container.style.height = '100vh';
            container.style.transform = 'none';
            console.log('[LocalMultiplayer] Forced container visibility via JS');
        }

        // Apply player colors to UI elements
        this._applyPlayerColors();

        // Ensure the game area has the correct class for grid layout
        const gameArea = document.querySelector('.multiplayer-game-area');
        if (gameArea) {
            gameArea.classList.remove('players-2', 'players-3', 'players-4');
            gameArea.classList.add(`players-${numPlayers}`);
            // Force game area centering
            gameArea.style.transform = 'none';
            gameArea.style.margin = '0 auto';
        }
    }

    /**
     * Resolve team/color data for multiplayer UI
     * @private
     */
    _getResolvedTeamId(playerIndex) {
        const teamId = this.matchConfig?.playerTeams?.[playerIndex];
        if (teamId === 0 || teamId === 1) {
            return teamId;
        }
        return playerIndex % 2;
    }

    _getTeamColorScheme(teamId) {
        const resolvedTeamId = teamId === 1 ? 1 : 0;
        return PLAYER_COLORS[resolvedTeamId] || PLAYER_COLORS[0];
    }

    _getPlayerColorScheme(playerIndex) {
        const stateColor = this.multiplayerState?.getPlayerColor?.(playerIndex);
        if (stateColor) {
            return stateColor;
        }

        if (this.matchConfig?.isTeamMode) {
            const teamId = this._getResolvedTeamId(playerIndex);
            return this._getTeamColorScheme(teamId);
        }

        return PLAYER_COLORS[playerIndex % PLAYER_COLORS.length] || PLAYER_COLORS[0];
    }

    _getTeamLabel(teamId) {
        return teamId === 1 ? 'Team B' : 'Team A';
    }

    _getTeamRoundStats() {
        const teamStats = new Map();
        const numPlayers = this.multiplayerState?.numPlayers || 0;

        for (let i = 0; i < numPlayers; i++) {
            const teamId = this._getResolvedTeamId(i);
            if (!teamStats.has(teamId)) {
                teamStats.set(teamId, { alivePlayers: [] });
            }
            if (this.multiplayerState.players[i]?.isAlive) {
                teamStats.get(teamId).alivePlayers.push(i);
            }
        }

        return teamStats;
    }

    _getTeamRoundOutcome() {
        if (!this.matchConfig?.isTeamMode) {
            return null;
        }

        const teamStats = this._getTeamRoundStats();
        const teamIds = Array.from(teamStats.keys());
        const aliveTeams = teamIds.filter(
            (teamId) => teamStats.get(teamId).alivePlayers.length > 0,
        );

        if (teamIds.length <= 1) {
            return null;
        }

        if (aliveTeams.length === 0) {
            return { winnerTeamId: null, teamStats, isDraw: true };
        }

        if (aliveTeams.length === 1) {
            return { winnerTeamId: aliveTeams[0], teamStats, isDraw: false };
        }

        return null;
    }

    _syncTeamRoundWins(teamId) {
        const numPlayers = this.multiplayerState?.numPlayers || 0;
        const teamWins = this.teamRoundWins[teamId] || 0;

        for (let i = 0; i < numPlayers; i++) {
            if (this._getResolvedTeamId(i) === teamId) {
                this.roundWins[`player${i + 1}`] = teamWins;
            }
        }
    }

    _recordTeamRoundWin(teamId) {
        const resolvedTeamId = teamId === 1 ? 1 : 0;
        this.teamRoundWins[resolvedTeamId] = (this.teamRoundWins[resolvedTeamId] || 0) + 1;
        this._syncTeamRoundWins(resolvedTeamId);
        return this.teamRoundWins[resolvedTeamId];
    }

    _getTeamAggregateStats(teamId) {
        const numPlayers = this.multiplayerState?.numPlayers || 0;
        let score = 0;
        let lines = 0;

        for (let i = 0; i < numPlayers; i++) {
            if (this._getResolvedTeamId(i) !== teamId) {
                continue;
            }

            const matchKey = `player${i + 1}`;
            const matchTotals = this.matchStats[matchKey] || { score: 0, lines: 0 };
            const playerState = this.multiplayerState?.players?.[i];

            score += (matchTotals.score || 0) + (playerState?.score || 0);
            lines += (matchTotals.lines || 0) + (playerState?.totalLinesCleared || 0);
        }

        return { score, lines };
    }

    _checkTeamMatchWinCondition(teamId) {
        if (!this.matchConfig) {
            return (this.teamRoundWins[teamId] || 0) >= 7;
        }

        const config = this.matchConfig;

        switch (config.endCondition) {
            case 'frags':
                return (this.teamRoundWins[teamId] || 0) >= config.endConditionValue;

            case 'time': {
                const elapsedMinutes = (Date.now() - this.matchStartTime) / 1000 / 60;
                return elapsedMinutes >= config.endConditionValue;
            }

            case 'points': {
                const targetScore = config.endConditionValue * 1000;
                const totals = this._getTeamAggregateStats(teamId);
                return totals.score >= targetScore;
            }

            case 'lines': {
                const totals = this._getTeamAggregateStats(teamId);
                return totals.lines >= config.endConditionValue;
            }

            case 'never':
                return false;

            default:
                return (this.teamRoundWins[teamId] || 0) >= config.endConditionValue;
        }
    }

    /**
     * Apply player-specific colors to UI elements
     * @private
     */
    _applyPlayerColors() {
        const numPlayers = this.matchConfig?.numPlayers || 2;

        for (let i = 1; i <= numPlayers; i++) {
            const scheme = this._getPlayerColorScheme(i - 1);
            const primary = scheme?.primary || '#3b82f6';
            const light = scheme?.light || primary;
            const glow = scheme?.glow || `${primary}80`;
            const backgroundTint = `${primary}0D`;

            // Update player card border
            const playerCard = document.getElementById(`player-${i}-card`);
            if (playerCard) {
                playerCard.style.setProperty('--player-primary', primary);
                playerCard.style.setProperty('--player-primary-light', light);
                playerCard.style.setProperty('--player-glow', glow);
                playerCard.style.borderColor = `${primary}80`; // 50% opacity
                playerCard.style.boxShadow = `0 0 20px ${primary}20`; // Glow
                playerCard.style.background = `linear-gradient(145deg, rgba(0, 0, 0, 0.5), ${backgroundTint})`;
            }

            // Darken the board explicitly
            const boardSection = document.querySelector(`#player-${i}-card .player-board-section`);
            if (boardSection) {
                boardSection.style.background = 'rgba(10, 8, 24, 0.8)';
            }

            // Update label color
            const label = document.querySelector(`#player-${i}-card .player-board-label`);
            if (label) {
                label.style.color = primary;
                label.style.borderColor = `${primary}40`;
                label.style.textShadow = `0 0 10px ${primary}80`;
            }

            const border = document.getElementById(`p${i}-border`);
            if (border) {
                border.style.borderColor = primary;
                border.style.borderTop = 'none';
                border.style.borderRadius = '0 0 12px 12px';
                border.style.boxShadow = `0 0 15px ${primary}60, inset 0 0 10px ${primary}40`;
            }

            // Update phaser container border
            const container = document.getElementById(`p${i}-phaser-container`);
            if (container) {
                container.style.border = `2px solid ${primary}`;
                container.style.borderTop = 'none';
                container.style.borderRadius = '0 0 12px 12px';
                container.style.boxShadow = `0 0 20px ${primary}40`;
            }

            const avatar = document.querySelector(`#player-${i}-card .player-avatar`);
            if (avatar) {
                avatar.style.borderColor = primary;
                avatar.style.setProperty('--player-primary', primary);
                avatar.style.setProperty('--player-glow', glow);
            }

            const avatarText = document.querySelector(`#player-${i}-card .avatar-text`);
            if (avatarText) {
                avatarText.style.color = primary;
                avatarText.style.textShadow = `0 0 6px ${primary}80`;
            }
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
        if (config.isInfinityLMS) {
            const maxRows = config.infinityMaxRows || 100;
            return config.isTeamMode
                ? `Last team standing wins (${maxRows} rows)`
                : `Last player standing wins (${maxRows} rows)`;
        }
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
    async handleRoundEnd(winner, isSelfKill = false) {
        if (winner && typeof winner === 'object' && winner.type === 'team') {
            await this._handleTeamRoundEnd(winner.teamId);
            return;
        }

        console.log(`[LocalMultiplayer] Round ended! Winner: ${winner}, isSelfKill: ${isSelfKill}`);

        // Increment round wins (frags), unless it was a self-kill (self-death)
        if (!isSelfKill) {
            this.roundWins[winner]++;
        } else {
            console.log(`[LocalMultiplayer] No frag awarded to ${winner} due to self-kill`);
        }

        const winnerIndex = parseInt(winner.replace('player', ''), 10) - 1;
        const winnerName = `Player ${winnerIndex + 1}`;
        const winnerWins = this.roundWins[winner];

        // Check if someone won the match based on win condition
        const wonMatch = this._checkMatchWinCondition(winner);

        if (wonMatch) {
            // For frags mode, the winner is whoever has the most individual kills,
            // not necessarily the round winner (they may have been outfragged mid-match)
            let matchWinner = winner;
            if (this.matchConfig?.endCondition === 'frags') {
                const np = this.matchConfig.numPlayers || 2;
                let maxF = -1;
                for (let fi = 0; fi < np; fi++) {
                    const mk = `player${fi + 1}`;
                    const f = (this.matchStats[mk]?.frags || 0) + (this.multiplayerState.frags[fi] ?? 0);
                    if (f > maxF) { maxF = f; matchWinner = `player${fi + 1}`; }
                }
            }
            console.log(`[LocalMultiplayer] ${winnerName} wins the match!`);
            await this._showMatchEnd(matchWinner);
            return;
        }

        // Quadra-style: Instant restart, just log it
        console.log(`[LocalMultiplayer] Starting next round... Winner: ${winnerName}, Wins: ${winnerWins}`);
        // Removed _showRoundEnd delay for instant transition
        await this._startNewRound();
    }

    async _handleTeamRoundEnd(teamId) {
        const resolvedTeamId = teamId === 1 ? 1 : 0;
        const teamName = this._getTeamLabel(resolvedTeamId);

        console.log(`[LocalMultiplayer] Round ended! Winner: ${teamName}`);

        const teamWins = this._recordTeamRoundWin(resolvedTeamId);
        const wonMatch = this._checkTeamMatchWinCondition(resolvedTeamId);

        if (wonMatch) {
            console.log(`[LocalMultiplayer] ${teamName} wins the match!`);
            await this._showMatchEnd({ type: 'team', teamId: resolvedTeamId });
            return;
        }

        console.log(`[LocalMultiplayer] Starting next round... Winner: ${teamName}, Wins: ${teamWins}`);
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
            case 'frags': {
                // Check if any player has reached the cumulative individual kill target
                const numFragPlayers = config.numPlayers || 2;
                for (let fi = 0; fi < numFragPlayers; fi++) {
                    const matchKey = `player${fi + 1}`;
                    const cumulative = (this.matchStats[matchKey]?.frags || 0) + (this.multiplayerState.frags[fi] ?? 0);
                    if (cumulative >= config.endConditionValue) return true;
                }
                return false;
            }

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
        width: 100 %;
        height: 100 %;
        background: rgba(0, 0, 0, 0.85);
        display: flex;
        flex - direction: column;
        align - items: center;
        justify - content: center;
        z - index: 10000;
        animation: fadeIn 0.3s ease;
        `;

        overlay.innerHTML = `
            < div style = "text-align: center; color: white;" >
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
            </div >
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
        console.log('[LocalMultiplayer] Starting new round...');

        // Clear death animations from previous round
        this._clearDeathAnimations();

        // Aggregate current round stats into match totals BEFORE resetting logic
        const { numPlayers } = this.multiplayerState;
        const now = Date.now();
        const roundDuration = now - (this.roundStartTime || this.matchStartTime);

        const accumulatedLog = {};
        for (let i = 0; i < numPlayers; i++) {
            const playerNum = i + 1;
            const matchKey = `player${playerNum}`;
            const playerState = this.multiplayerState.players[i];
            if (!playerState) continue;

            if (!this.matchStats[matchKey]) {
                this.matchStats[matchKey] = {
                    score: 0,
                    lines: 0,
                    pieceCounts: {
                        I: 0, J: 0, L: 0, O: 0, S: 0, T: 0, Z: 0,
                    },
                    lineClearCounts: {
                        1: 0, 2: 0, 3: 0, 4: 0,
                    },
                };
            }

            // Ensure substructures exist
            if (!this.matchStats[matchKey].pieceCounts) {
                this.matchStats[matchKey].pieceCounts = {
                    I: 0, J: 0, L: 0, O: 0, S: 0, T: 0, Z: 0,
                };
            }
            if (!this.matchStats[matchKey].lineClearCounts) {
                this.matchStats[matchKey].lineClearCounts = {
                    1: 0, 2: 0, 3: 0, 4: 0,
                };
            }

            this.matchStats[matchKey].score += playerState.score || 0;
            this.matchStats[matchKey].lines += playerState.totalLinesCleared || 0;
            this.matchStats[matchKey].frags = (this.matchStats[matchKey].frags || 0) + (this.multiplayerState.frags[i] || 0);
            this.matchStats[matchKey].deaths = (this.matchStats[matchKey].deaths || 0) + (this.multiplayerState.deaths[i] || 0);
            this.matchStats[matchKey].duration = (this.matchStats[matchKey].duration || 0) + roundDuration;

            // Aggregate pieces
            for (const key in playerState.pieceCounts) {
                this.matchStats[matchKey].pieceCounts[key] = (this.matchStats[matchKey].pieceCounts[key] || 0) + (playerState.pieceCounts[key] || 0);
            }
            // Aggregate clears
            for (const key in playerState.lineClearCounts) {
                this.matchStats[matchKey].lineClearCounts[key] = (this.matchStats[matchKey].lineClearCounts[key] || 0) + (playerState.lineClearCounts[key] || 0);
            }

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

        // Quadra-style instant restart: no countdown between rounds
        // Play a start sound to signal the round beginning
        this.deps.soundManager.sfxPlayer.playDrop?.();

        // Spawn initial pieces for all configured players
        for (let i = 0; i < numPlayers; i++) {
            const playerNum = i + 1;
            const nextCanvases = this.playerNextCanvases.get(playerNum);

            console.log(`[LocalMultiplayer] Spawning initial piece for Player ${playerNum}...`);
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
        console.log('[LocalMultiplayer] Starting game loop...');
        this._startGameLoop();

        console.log('[LocalMultiplayer] New round started!');
        this.roundStartTime = Date.now();
    }

    /**
     * Show match end (someone won the required number of rounds)
     * @private
     */
    async _showMatchEnd(winner) {
        let winnerName = 'Player 1';
        if (winner === 'draw') {
            winnerName = 'Draw';
        } else if (winner && typeof winner === 'object' && winner.type === 'team') {
            const resolvedTeamId = winner.teamId === 1 ? 1 : 0;
            winnerName = this._getTeamLabel(resolvedTeamId);
        } else if (typeof winner === 'string') {
            const winnerIndex = parseInt(winner.replace('player', ''), 10) - 1;
            winnerName = `Player ${winnerIndex + 1}`;
        }
        const { numPlayers } = this.multiplayerState;

        let fragsText = '';
        for (let i = 0; i < numPlayers; i++) {
            if (i > 0) fragsText += ' - ';
            fragsText += this.multiplayerState.frags[i] ?? 0;
        }

        console.log(`[LocalMultiplayer] Match ended! Winner: ${winnerName}`);

        // Stop the game
        await this.onStop();

        // Show match result

        // Prepare detailed stats data
        const now = Date.now();
        const currentDuration = now - (this.roundStartTime || this.matchStartTime);
        const players = [];
        for (let i = 0; i < numPlayers; i++) {
            const key = `player${i + 1}`;
            const stats = this.matchStats[key] || {};
            const current = this.multiplayerState.players[i] || {};

            const finalScore = (stats.score || 0) + (current.score || 0);
            const finalLines = (stats.lines || 0) + (current.totalLinesCleared || 0);
            const finalDeaths = (stats.deaths || 0) + (this.multiplayerState.deaths[i] || 0);
            const frags = this.multiplayerState.frags[i] || 0;

            // Aggregate pieces
            const pieces = { ...stats.pieceCounts };
            if (current.pieceCounts) {
                for (const k in current.pieceCounts) {
                    pieces[k] = (pieces[k] || 0) + (current.pieceCounts[k] || 0);
                }
            }

            // Calculate BPM/PPM
            const totalDuration = (stats.duration || 0) + currentDuration;
            const minutes = Math.max(totalDuration / 60000, 0.001);
            const totalPieces = Object.values(pieces).reduce((a, b) => a + b, 0);

            const bpm = Math.round(totalPieces / minutes);
            const ppm = Math.round(finalScore / minutes);

            // Aggregate clears
            const clears = { ...stats.lineClearCounts };
            if (current.lineClearCounts) {
                for (const k in current.lineClearCounts) {
                    clears[k] = (clears[k] || 0) + (current.lineClearCounts[k] || 0);
                }
            }

            players.push({
                name: `P${i + 1}`,
                score: finalScore,
                lines: finalLines,
                deaths: finalDeaths,
                frags,
                bpm,
                ppm,
                pieces,
                clears,
            });
        }

        // CSS Styles Injection
        const styleBlock = `
            <style>
                @keyframes scaleIn { from { transform: scale(0.9); opacity: 0; } to { transform: scale(1); opacity: 1; } }
                @keyframes slideUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
                @keyframes pulseGlow { 0% { text-shadow: 0 0 20px rgba(16, 185, 129, 0.4); } 50% { text-shadow: 0 0 40px rgba(16, 185, 129, 0.8); } 100% { text-shadow: 0 0 20px rgba(16, 185, 129, 0.4); } }
                
                #match-end-overlay {
                    font-family: 'Inter', system-ui, sans-serif;
                }

                .glass-panel {
                    background: rgba(15, 23, 42, 0.7);
                    backdrop-filter: blur(20px);
                    -webkit-backdrop-filter: blur(20px);
                    border: 1px solid rgba(255, 255, 255, 0.08);
                    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.6);
                    border-radius: 24px;
                    padding: 40px;
                    max-width: 1000px;
                    width: 95%;
                    animation: scaleIn 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards;
                    opacity: 0; 
                }
                
                .winner-title {
                    font-size: 64px;
                    font-weight: 900;
                    margin-bottom: 8px;
                    background: linear-gradient(135deg, #34d399 0%, #10b981 100%);
                    -webkit-background-clip: text;
                    -webkit-text-fill-color: transparent;
                    filter: drop-shadow(0 0 30px rgba(16, 185, 129, 0.4));
                    letter-spacing: -2px;
                    animation: slideUp 0.6s ease-out forwards;
                }

                .win-condition {
                    font-size: 18px;
                    color: #94a3b8;
                    margin-bottom: 30px;
                    animation: slideUp 0.6s ease-out 0.1s forwards;
                    opacity: 0;
                }

                .stat-grid {
                    display: grid;
                    grid-template-columns: 180px repeat(${numPlayers}, 1fr);
                    margin: 0 0 40px 0;
                    border-radius: 12px;
                    overflow: hidden;
                    border: 1px solid rgba(255, 255, 255, 0.05);
                    background: rgba(0, 0, 0, 0.2);
                    animation: slideUp 0.6s ease-out 0.2s forwards;
                    opacity: 0;
                }
                
                .grid-header-row {
                    display: contents;
                    font-weight: 700;
                    font-size: 13px;
                    text-transform: uppercase;
                    letter-spacing: 1px;
                    color: #94a3b8;
                }

                .grid-header-cell {
                    padding: 16px;
                    background: rgba(255, 255, 255, 0.03);
                    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
                    text-align: center;
                }
                .grid-header-cell:first-child { text-align: left; }

                .grid-row { display: contents; }
                
                .grid-cell {
                    padding: 14px 16px;
                    color: #e2e8f0;
                    border-bottom: 1px solid rgba(255, 255, 255, 0.03);
                    font-size: 16px;
                    text-align: center;
                    transition: background 0.2s;
                }
                
                .grid-cell.label {
                    text-align: left;
                    font-weight: 500;
                    color: #cbd5e1;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }
                
                .grid-cell.highlight {
                    background: rgba(16, 185, 129, 0.05);
                    color: #34d399;
                    font-weight: 600;
                }

                .grid-row:hover .grid-cell {
                    background: rgba(255, 255, 255, 0.04);
                }
                .grid-row:hover .grid-cell.highlight {
                    background: rgba(16, 185, 129, 0.08);
                }

                .separator {
                    grid-column: 1 / -1;
                    height: 1px;
                    background: rgba(255, 255, 255, 0.08);
                    margin: 4px 0;
                }

                .btn-primary {
                    font-size: 18px;
                    padding: 14px 32px;
                    background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
                    box-shadow: 0 4px 20px rgba(99, 102, 241, 0.3);
                    border: none;
                    border-radius: 12px;
                    color: white;
                    cursor: pointer;
                    font-weight: 600;
                    transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
                    animation: slideUp 0.6s ease-out 0.4s forwards;
                    opacity: 0;
                }
                .btn-primary:hover {
                    box-shadow: 0 8px 30px rgba(99, 102, 241, 0.5);
                    transform: translateY(-2px);
                }
                .btn-primary:active {
                    transform: translateY(0);
                }
            </style>
        `;

        // Helper to generate a stat row
        const genRow = (icon, label, accessor) => {
            let html = `<div class="grid-row">
                          <div class="grid-cell label">${icon} ${label}</div>`;
            players.forEach((p) => {
                const value = accessor(p);
                // Mark value for animation
                const isNum = typeof value === 'number';
                const formatted = isNum ? 0 : value; // Start at 0
                const target = isNum ? value : '';
                const highlightClass = p.isWinner ? 'highlight' : '';

                html += `<div class="grid-cell ${highlightClass}">
                            <span class="stat-value" data-target="${target}">${formatted}</span>
                         </div>`;
            });
            html += '</div>';
            return html;
        };

        // Screen HTML
        const overlay = document.createElement('div');
        overlay.id = 'match-end-overlay';
        overlay.style.cssText = `
            position: fixed;
            top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0, 0, 0, 0.6);
            backdrop-filter: blur(8px);
            display: flex;
            align-items: center; 
            justify-content: center;
            z-index: 10000;
        `;

        overlay.innerHTML = `
            ${styleBlock}
            <div class="glass-panel">
                <div style="text-align: center;">
                    <div class="winner-title">
                        👑 ${winnerName} WINS! 👑
                    </div>
                    <div class="win-condition">
                        ${this._getWinConditionText()}
                    </div>
                </div>

                <div class="stat-grid">
                    <!-- Header -->
                    <div class="grid-header-row">
                        <div class="grid-header-cell">Statistic</div>
                        ${players.map((p) => `<div class="grid-header-cell ${p.isWinner ? 'highlight' : ''}">${p.name}</div>`).join('')}
                    </div>

                    <!-- Core Stats -->
                    ${genRow('🏆', 'Score', (p) => p.score)}
                    ${genRow('⚡', 'BPM', (p) => p.bpm)}
                    ${genRow('📈', 'PPM', (p) => p.ppm)}
                    
                    <div class="separator"></div>
                    
                    ${genRow('⚔️', 'Frags', (p) => p.frags)}
                    ${genRow('💀', 'Deaths', (p) => p.deaths)}
                    ${genRow('📊', 'Lines', (p) => p.lines)}

                    <div class="separator"></div>

                    <!-- Clears -->
                    ${genRow('1️⃣', 'Single', (p) => p.clears[1] || 0)}
                    ${genRow('2️⃣', 'Double', (p) => p.clears[2] || 0)}
                    ${genRow('3️⃣', 'Triple', (p) => p.clears[3] || 0)}
                    ${genRow('4️⃣', 'Tetris', (p) => p.clears[4] || 0)}
                </div>

                <div style="text-align: center; display: flex; gap: 20px; justify-content: center;">
                    <button id="restart-match-btn" class="btn-primary" style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); box-shadow: 0 4px 20px rgba(16, 185, 129, 0.3);">
                        Restart Match
                    </button>
                    <button id="return-to-menu-btn" class="btn-primary">
                        Return to Menu
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        // Animation Logic
        const animateValue = (obj, start, end, duration) => {
            let startTimestamp = null;
            const step = (timestamp) => {
                if (!startTimestamp) startTimestamp = timestamp;
                const progress = Math.min((timestamp - startTimestamp) / duration, 1);
                // Ease out quart
                const ease = 1 - (1 - progress) ** 4;

                const current = Math.floor(ease * (end - start) + start);
                obj.innerHTML = current.toLocaleString();
                if (progress < 1) {
                    window.requestAnimationFrame(step);
                }
            };
            window.requestAnimationFrame(step);
        };

        // Trigger animations
        setTimeout(() => {
            const counters = overlay.querySelectorAll('.stat-value');
            counters.forEach((counter) => {
                const target = parseInt(counter.getAttribute('data-target'), 10);
                if (!isNaN(target) && target > 0) {
                    animateValue(counter, 0, target, 1500);
                } else if (!isNaN(target)) {
                    counter.innerHTML = target.toLocaleString();
                }
            });
        }, 500);

        // Handle buttons
        const restartBtn = document.getElementById('restart-match-btn');
        restartBtn.addEventListener('click', () => {
            overlay.style.transition = 'opacity 0.3s';
            overlay.style.opacity = '0';
            setTimeout(() => {
                overlay.remove();
                this.onStart();
            }, 300);
        });

        // Handle return button
        const returnBtn = document.getElementById('return-to-menu-btn');
        returnBtn.addEventListener('click', () => {
            // Fade out
            overlay.style.transition = 'opacity 0.3s';
            overlay.style.opacity = '0';
            setTimeout(() => {
                overlay.remove();
                // Reset round wins
                this.roundWins.player1 = 0;
                this.roundWins.player2 = 0;
                this.roundWins.player3 = 0;
                this.roundWins.player4 = 0;
                this.teamRoundWins = { 0: 0, 1: 0 };
                eventBus.emit(EVENTS.EXIT_TO_MAIN_MENU);
            }, 300);
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
            text-shadow: 0 0 10px rgba(239, 68, 68, 0.8);
            opacity: 0;
            transform: translateY(20px);
            transition: all 0.5s cubic-bezier(0.68, -0.55, 0.265, 1.55) 0.1s;
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
        // Search globally for any death overlays and remove them
        const lingeringOverlays = document.querySelectorAll('.player-death-overlay');
        if (lingeringOverlays.length > 0) {
            console.log(`[LocalMultiplayer] Found ${lingeringOverlays.length} lingering overlays via global search`);
            lingeringOverlays.forEach((overlay) => {
                console.log('[LocalMultiplayer] Force removing lingering overlay');
                overlay.remove();
            });
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
                || document.getElementById(`p${playerNum}-container`)
                || document.getElementById(`player-${playerNum}-card`); // Fallback to card ID

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
