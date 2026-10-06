import { BaseGameMode } from './BaseGameMode.js';
import { BoardJuice } from '../../rendering/phaser/board-juice.js';
import { MultiPlayerState, PLAYER_COLORS, TEAM_COLORS } from '../multi-player-state.js';
import { InfinityMinimap } from '../../ui/infinity/InfinityMinimap.js';
import { GAME_MODES, BLOCK_SIZE } from '../constants.js';
import {
    spawnPiece,
    fillBag,
    move as coreMove,
    rotate as coreRotate,
    softDrop as coreSoftDrop,
    hardDrop as coreHardDrop,
} from '../game.js';
import { createEmptyMatchMetrics, accumulateMatchMetrics } from '../match-metrics.js';
import { LocalBotManager } from '../ai/local-bot-manager.js';

import { expandGridIfNeeded, calculateBuildHeight } from '../infinity-grid.js';
import { bindLegacySessionRng, generateSessionSeed } from '../session-rng.js';
import { drawNextPieces } from '../../rendering/draw.js';
import { showLocalMatchEnd } from '../../ui/local-match-end-overlay.js';
import { LocalMatchConfigModal } from '../../ui/local-match-config-modal.js';
import { LocalVersusHud, versusGoal } from '../../ui/local-versus-hud.js';
import { applyVersusLayout, readVersusViewport, versusLayout } from '../../ui/local-versus-layout.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import {
    showCinematicLoadingOverlay,
    waitForCinematicLoadingOverlayPresented,
    dismissCinematicLoadingOverlay,
    transitionCinematicLoadingOverlayToCountdown,
} from '../../ui/cinematic-loading-overlay.js';
import { createLocalMultiplayerBoards, destroyLocalMultiplayerBoards } from '../../rendering/phaser/local-board-hosts.js';
import {
    captureLocalMultiplayerClock,
    captureLocalMultiplayerRound,
    clearLocalMultiplayerFixedInput,
    configureLocalMultiplayerSimulationClock,
    drainLocalMultiplayerRound,
    ownsLocalMultiplayerRound,
    retireLocalMultiplayerRound,
    resolveLocalMultiplayerMatchResult,
    startLocalMultiplayerModeLoop,
    stopLocalMultiplayerModeLoop,
} from './local-multiplayer-loop.js';

const MATCH_START_LOADING_MIN_VISIBLE_MS = 2000;
/** How long a knock-out and a round won hold the boards before the round ends. */
export const ROUND_OUTCOME_MS = 1500;
/** The match won, on the boards, before the results. */
const VICTORY_BEAT_MS = 2400;

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
        this._startGeneration = 0;
        this._gameLoopGeneration = 0;
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
        this.phaserGames = [];
        this._boardCreationGeneration = 0;

        // Canvas references for next pieces
        this.p1NextCanvases = [];
        this.p2NextCanvases = [];
        this.playerNextCanvases = new Map();

        // Match configuration (from modal)
        this.matchConfig = null;
        this.configModal = null;
        this.configuredForStart = false; // Track if config modal has been shown
        this.matchStartLoadingOverlay = null;
        this.botManager = null;

        // Round tracking (frags) - will be configured by modal
        this.roundWins = {
            player1: 0,
            player2: 0,
            player3: 0,
            player4: 0,
        };
        // Keyed by team id (0..3); missing keys read as 0, so this supports any team count.
        this.teamRoundWins = {};
        this.lastMatchResultClock = null;

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

        const configurationGeneration = ++this._startGeneration;
        const ownsConfiguration = () => (
            configurationGeneration === this._startGeneration
            && this.isActive
            && this.matchConfig === config
        );
        let startInvoked = false;

        this.matchConfig = config;
        this.configuredForStart = true;

        this.matchStartLoadingOverlay = showCinematicLoadingOverlay(
            this._getMatchStartLoadingTitle(config),
            { themeManager: this.deps.themeManager },
        );

        try {
            // Commit the cover and async theme loading before preparing boards.
            await waitForCinematicLoadingOverlayPresented();
            if (!ownsConfiguration()) return;

            // Now setup the UI for the configured number of players.
            await this._setupMultiplayerUI();
            if (!ownsConfiguration()) return;

            console.log('[LocalMultiplayer] UI setup complete, starting match...');

            // Automatically start the match after configuration.
            startInvoked = true;
            await this.onStart();
        } catch (error) {
            if (!startInvoked && !ownsConfiguration()) return;
            console.error('[LocalMultiplayer] Failed to start configured match:', error);
            if (startInvoked) {
                try {
                    await this.onStop();
                } catch (stopError) {
                    console.error('[LocalMultiplayer] Failed to roll back partial start:', stopError);
                }
                this._removeInputWrappers();
                this.configuredForStart = false;
            }
            if (this.matchConfig === config) this._destroySeparatePhaserGames();
            await this._dismissMatchStartLoadingOverlay({ fadeOutMs: 300, minVisibleMs: 0 });
            // Back to the setup sheet, which says what went wrong (no blocking alert).
            this.configModal?.show();
            this.configModal?.showError(`The match could not start. ${error.message}`);
        }
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
        this._destroySeparatePhaserGames();

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
        const boardsCreated = await this._createSeparatePhaserGames();
        if (!boardsCreated) return;

        // Pause single player scene
        this._pauseSinglePlayerScene();

        console.log('[LocalMultiplayer] UI setup complete');
    }

    _getMatchStartLoadingTitle(config = this.matchConfig) {
        if (config?.isInfinityLMS) {
            return 'LAST STANDING';
        }
        if (config?.hotPotato || config?.attackStyle === 'hot_potato') {
            return 'HOT POTATO';
        }
        return 'FREE-FOR-ALL';
    }

    async _dismissMatchStartLoadingOverlay({
        fadeOutMs = 800,
        minVisibleMs = MATCH_START_LOADING_MIN_VISIBLE_MS,
    } = {}) {
        if (!this.matchStartLoadingOverlay) return;

        await dismissCinematicLoadingOverlay({ fadeOutMs, minVisibleMs });
        this.matchStartLoadingOverlay = null;
    }

    async _waitForMatchStartLoadingOverlayMinVisible(
        minVisibleMs = MATCH_START_LOADING_MIN_VISIBLE_MS,
    ) {
        if (!this.matchStartLoadingOverlay) return;

        const elapsedMs = Date.now() - Number(this.matchStartLoadingOverlay.shownAt || Date.now());
        const remainingVisibleMs = Math.max(0, minVisibleMs - elapsedMs);
        if (remainingVisibleMs > 0) await new Promise((resolve) => { setTimeout(resolve, remainingVisibleMs); });
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

        // Show the seats in play (keystone-versus.css lays them out; a team shows on its
        // plate, local-versus-hud.js).
        for (let i = 1; i <= 4; i++) {
            const playerCard = document.getElementById(`player-${i}-card`);
            if (playerCard) {
                const inPlay = i <= numPlayers;
                playerCard.style.display = inPlay ? '' : 'none';
                if (inPlay) playerCard.removeAttribute('aria-hidden');
                else playerCard.setAttribute('aria-hidden', 'true');
                playerCard.classList.toggle('infinity-lms', inPlay && Boolean(this.matchConfig?.isInfinityLMS));
            }
        }

        console.log(`[LocalMultiplayer] Layout updated for ${numPlayers} players${this.matchConfig?.isInfinityLMS ? ' (Infinity LMS mode)' : ''}`);
    }

    /**
     * Called when user clicks "Start Game"
     */
    async onStart(options = {}) {
        if (!this.configuredForStart || !this.matchConfig) {
            console.log('[LocalMultiplayer] Configuration not set, waiting for user to configure');
            return;
        }

        this._startGeneration += 1;
        const startGeneration = this._startGeneration;
        const ownsStart = () => startGeneration === this._startGeneration && this.isActive && this.isRunning;
        await super.onStart();
        if (!ownsStart()) return;

        if (this.deps.soundManager?.resumeThemeLinkedMusic) {
            this.deps.soundManager.resumeThemeLinkedMusic(true);
        }
        if (this.deps.themeManager?.resumeThemes) {
            await this.deps.themeManager.resumeThemes();
            if (!ownsStart()) return;
        }
        if (this.deps.themeManager?.waitForThemeReady) {
            await this.deps.themeManager.waitForThemeReady(3000);
            if (!ownsStart()) return;
        }
        if (this.deps.soundManager?.ensureTrackPlaybackSynced) {
            await this.deps.soundManager.ensureTrackPlaybackSynced({
                reason: 'local-multiplayer-start',
                force: true,
            });
            if (!ownsStart()) return;
        }

        const { introAnimation } = await import('../../ui/intro-animation.js');
        if (!ownsStart()) return;
        const introDismissPromise = Promise.resolve(
            introAnimation?.dismiss?.(),
        );

        this.deps.modalManager.hideAll();
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
        this.teamRoundWins = {};
        this.lastMatchResultClock = null;

        this.matchStartTime = Date.now();
        this.versusRound = 1;
        this.versusHud?.mount();

        const numPlayers = this.matchConfig?.numPlayers || 2;
        this.multiplayerState = new MultiPlayerState(numPlayers);
        // Attacks are drawn between the boards (local-versus-hud.js).
        this.multiplayerState.onAttack = (from, targets, lines) => this.versusHud?.showAttack(from, targets, lines);
        this.multiplayerState.setMatchConfig(this.matchConfig);
        this.multiplayerState.reset();
        configureLocalMultiplayerSimulationClock(this);
        // Apply per-player Quadra handicap levels AFTER reset() (which restores the
        // default level). No-op unless the host picked differing levels.
        this.multiplayerState.setPlayerHandicaps(this.matchConfig?.playerHandicaps);
        this.multiplayerState.isPaused = true;

        this._activatePhaserMultiplayerUI();
        this._hideMultiplayerBoardsForCountdown();

        if (!this.boardScenes || this.boardScenes.length === 0) {
            throw new Error('Board scenes not initialized. Call onActivate first.');
        }

        this._syncBoardScenes();
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

        this._initializeSharedPieceRng(options.seed);
        for (let i = 0; i < numPlayers; i++) {
            const playerNum = i + 1;
            const canvases = this.playerNextCanvases.get(playerNum);
            if (canvases && canvases.length) {
                drawNextPieces(canvases, this.multiplayerState.players[i].nextPieces);
            }
        }

        this._updateMultiplayerStats(0);

        await this.deps.themeManager?.whenLoadingSurfacePipelinesSettled?.(5000);
        if (!ownsStart()) return;
        await this._waitForMatchStartLoadingOverlayMinVisible();
        if (!ownsStart()) return;
        await introDismissPromise;
        if (!ownsStart()) return;
        await transitionCinematicLoadingOverlayToCountdown({
            startCount: 5,
            onCount: () => ownsStart() && this.deps.soundManager.sfxPlayer.playMove?.(),
            onGo: () => ownsStart() && this.deps.soundManager.sfxPlayer.playDrop?.(),
            onFirstCountVisible: () => ownsStart() && this._revealMultiplayerBoardsForCountdown(),
        });
        if (!ownsStart()) return;
        this.matchStartLoadingOverlay = null;

        this.multiplayerState.lastTime = performance.now();

        // Spawn pieces for all configured players
        for (let i = 0; i < numPlayers; i++) {
            const playerNum = i + 1;
            const nextCanvases = this.playerNextCanvases.get(playerNum);
            const playerState = this.multiplayerState.players[i];

            spawnPiece(playerState, () => {
                if (nextCanvases) {
                    drawNextPieces(nextCanvases, playerState.nextPieces);
                }
                this._syncBoardScenes();
            }, () => this._handleGameOver(i));
        }

        this._syncBoardScenes();

        this._setupInputWrappers();
        this._setupLocalBots();

        this.multiplayerState.isPaused = false;
        this.multiplayerState.lastTime = performance.now();
        this._startGameLoop();
        // Each human board shows its controls for the first seconds of the match.
        this.versusHud?.showCoach();
    }

    _initializeSharedPieceRng(seed) {
        const { players } = this.multiplayerState;
        const sharedSeed = seed === undefined ? generateSessionSeed() : seed;
        const descriptors = players.map((player) => (
            bindLegacySessionRng(player, sharedSeed)
        ));
        const rngDescriptor = descriptors[0];
        this.multiplayerState.rngDescriptor = rngDescriptor;
        this.multiplayerState.sharedPieceSeed = rngDescriptor.seed;
        players.forEach((player) => {
            player.rngDescriptor = rngDescriptor;
            fillBag(player.nextPieces, player.randomGenerator);
        });
        return rngDescriptor;
    }

    /**
     * Pause/resume wiring lives in BaseGameMode (§4.6 slice 2) — this mode's
     * pausable sim is the shared multiplayerState (its own rAF loop early-outs
     * on multiplayerState.isPaused).
     */
    _getPausableGameState() {
        return this.multiplayerState || null;
    }

    onPause() {
        super.onPause();
        clearLocalMultiplayerFixedInput(this);
    }

    /**
     * Called when game ends
     */
    async onStop() {
        this._startGeneration += 1;
        const retiredRound = retireLocalMultiplayerRound(this);
        await super.onStop();

        console.log('[LocalMultiplayer] Stopping game...');

        // Mark game as over
        if (retiredRound.multiplayerState) {
            retiredRound.multiplayerState.isGameOver = true;
        }
        await drainLocalMultiplayerRound(this, retiredRound);

        if (this.botManager) {
            this.botManager.destroy();
            this.botManager = null;
        }
    }

    /**
     * Called when mode is deselected
     */
    async onDeactivate() {
        this._startGeneration += 1;
        // Retire in-flight board creation before the first teardown await.
        this._boardCreationGeneration += 1;
        await super.onDeactivate();
        this._destroySeparatePhaserGames();

        console.log('[LocalMultiplayer] Deactivating...');
        await this._dismissMatchStartLoadingOverlay({ fadeOutMs: 200, minVisibleMs: 0 });

        if (this.botManager) {
            this.botManager.destroy();
            this.botManager = null;
        }

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

        // Clear the plates and the match bar
        this.versusHud?.destroy();
        this.versusHud = null;

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

    /** Retire every callback owned by the current local simulation loop. */
    _stopGameLoop() {
        stopLocalMultiplayerModeLoop(this);
    }

    /** Start the multiplayer game loop. @private */
    _startGameLoop() {
        startLocalMultiplayerModeLoop(this);
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

        // Update Hot Potato UI indicators (runs every frame for smooth timer)
        if (this.multiplayerState.hotPotato?.enabled) {
            const potatoState = this.multiplayerState.getHotPotatoState(Date.now());
            const { holderIndex } = potatoState;
            const { timeRemainingMs } = potatoState;
            const formattedTime = `${(timeRemainingMs / 1000).toFixed(1)}s`;

            for (let i = 0; i < numPlayers; i++) {
                const card = document.getElementById(`player-${i + 1}-card`);
                if (card) {
                    if (i === holderIndex && !this.multiplayerState.players[i].isGameOver) {
                        card.classList.add('hot-potato-holder');
                        card.setAttribute('data-potato-time', formattedTime);
                    } else {
                        card.classList.remove('hot-potato-holder');
                        card.removeAttribute('data-potato-time');
                    }
                }
            }
        } else {
            // Ensure classes are cleared when disabled
            for (let i = 0; i < numPlayers; i++) {
                const card = document.getElementById(`player-${i + 1}-card`);
                if (card) {
                    card.classList.remove('hot-potato-holder');
                    card.removeAttribute('data-potato-time');
                }
            }
        }

        // Skip DOM updates most frames (run at ~6fps for text stats)
        // But ALWAYS update minimaps for smooth animation
        const shouldUpdateText = frameCount % 10 === 0;

        if (shouldUpdateText) this._updateStandingsHUD();

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
     * The plates and the match bar for this match (src/ui/local-versus-hud.js).
     * Called once from _setupMultiplayerUI().
     * @private
     */
    _initStandingsHUD() {
        this.versusHud?.destroy();
        this.versusHud = new LocalVersusHud({
            config: this.matchConfig || {},
            numPlayers: this.matchConfig?.numPlayers || 2,
            colorFor: (i) => this._getPlayerColorScheme(i),
            teamLabel: (teamId) => this._getTeamLabel(teamId),
            settings: this.deps.settingsManager?.get?.() || {},
        });
        this.versusHud.mount();
    }

    /**
     * Live numbers for the plates and the match bar: the match so far plus this round.
     * Called inside the shouldUpdateText throttle in _updateMultiplayerStats().
     * @private
     */
    _updateStandingsHUD() {
        if (!this.versusHud || !this.multiplayerState) return;
        const { players } = this.multiplayerState;
        const entries = this._matchTotals().map((totals, i) => {
            const playerState = players[i] || {};
            const board = playerState.boardGrid || playerState.board;
            return {
                ...totals,
                level: playerState.level ?? 1,
                // Filled rows from the floor: the well turns coral near the top.
                stack: board && !this.matchConfig?.isInfinityLMS ? board.length - this._findHighestBlockRow(board) : 0,
                // Garbage waiting to rise: the meter beside the board.
                incoming: this.multiplayerState.garbageQueues?.[i]?.getTotalLines?.() ?? 0,
                // Last Standing: rows left before this stack reaches the roof.
                toRoof: this.matchConfig?.isInfinityLMS
                    ? Math.max(0, (playerState.maxRows || 100) - calculateBuildHeight(playerState)) : 0,
                isAlive: playerState.isAlive !== false,
                team: this._getResolvedTeamId(i),
            };
        });
        // Teams race by their rule: rounds won for a frag goal, the team's sum otherwise.
        let teamTotals = null;
        if (this.matchConfig?.isTeamMode) {
            const { key } = this.versusHud.metric;
            teamTotals = {};
            new Set(entries.map((e) => e.team)).forEach((teamId) => {
                teamTotals[teamId] = key === 'frags'
                    ? (this.teamRoundWins[teamId] || 0)
                    : (this._getTeamAggregateStats(teamId)[key] || 0);
            });
        }
        const limitMs = this.matchConfig?.endCondition === 'time'
            ? (Number(this.matchConfig.endConditionValue) || 0) * 60000 : null;
        this.versusHud.update(entries, {
            round: this.versusRound || 1,
            // The HUD reads the wall clock (as _checkMatchWinCondition times the match).
            clock: limitMs === null ? null : { limitMs, startedAt: this.matchStartTime },
            teamTotals,
        });
    }

    /**
     * Each player's match so far: the rounds played plus this one.
     * @private
     */
    _matchTotals() {
        const { numPlayers, players, frags } = this.multiplayerState;
        return Array.from({ length: numPlayers }, (_, i) => {
            const totals = this.matchStats[`player${i + 1}`] || {};
            const playerState = players[i] || {};
            return {
                frags: (totals.frags || 0) + (frags[i] ?? 0),
                score: (totals.score || 0) + (playerState.score || 0),
                lines: (totals.lines || 0) + (playerState.totalLinesCleared || 0),
            };
        });
    }

    /** The team with the highest match score (a timed team match). @private */
    _leadingTeamByScore() {
        const teams = new Set(this.multiplayerState.players.map((_, i) => this._getResolvedTeamId(i)));
        let leader = null;
        let best = -1;
        teams.forEach((teamId) => {
            const { score } = this._getTeamAggregateStats(teamId);
            if (score > best) {
                best = score;
                leader = teamId;
            }
        });
        return leader;
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

    /** Resolve all top-outs reported by one completed fixed-tick player barrier. */
    async _handleFixedTickTopOutBatch(playerIndices, roundOwner) {
        if (
            !ownsLocalMultiplayerRound(this, roundOwner)
            || !this._localSimulationLoop?.fixedTickEnabled
            || this.matchConfig?.isInfinityLMS
        ) return false;

        const lastAttackers = this.multiplayerState.lastAttackerIds.slice();
        const eliminated = this.multiplayerState.handlePlayerDeaths(playerIndices);
        if (eliminated.length === 0) return false;
        eliminated.forEach((playerIndex) => {
            const player = this.multiplayerState.players[playerIndex];
            if (player?.currentPiece) player.currentPiece = null;
            this._showPlayerDeathAnimation(playerIndex, lastAttackers[playerIndex]);
        });

        const waitForOutcome = async () => {
            await new Promise((resolve) => setTimeout(resolve, ROUND_OUTCOME_MS));
            return ownsLocalMultiplayerRound(this, roundOwner);
        };
        const matchResult = resolveLocalMultiplayerMatchResult(this.multiplayerState);
        if (matchResult !== null) {
            this.multiplayerState.isPaused = true;
            if (await waitForOutcome()) await this._showMatchEnd(matchResult);
            return true;
        }
        if (this.matchConfig?.isTeamMode) {
            const outcome = this._getTeamRoundOutcome();
            if (!outcome) return true;
            this.multiplayerState.isPaused = true;
            if (outcome.isDraw || outcome.winnerTeamId === null) {
                if (await waitForOutcome()) await this._startNewRound();
                return true;
            }
            const winners = outcome.teamStats.get(outcome.winnerTeamId)?.alivePlayers || [];
            winners.forEach((playerIndex) => this._showVictoryAnimation(playerIndex));
            if (await waitForOutcome()) {
                await this.handleRoundEnd({ type: 'team', teamId: outcome.winnerTeamId });
            }
            return true;
        }

        const aliveIndices = this.multiplayerState.players
            .map((player, playerIndex) => (player.isAlive ? playerIndex : -1))
            .filter((playerIndex) => playerIndex >= 0);
        if (aliveIndices.length > 1) return true;
        this.multiplayerState.isPaused = true;
        if (aliveIndices.length === 0) {
            if (await waitForOutcome()) await this._startNewRound();
            return true;
        }

        const winnerIndex = aliveIndices[0];
        const winnerKey = `player${winnerIndex + 1}`;
        const winnerEarnedFrag = eliminated.some(
            (playerIndex) => lastAttackers[playerIndex] === winnerIndex,
        );
        this._showVictoryAnimation(winnerIndex);
        if (await waitForOutcome()) {
            await this.handleRoundEnd(winnerKey, !winnerEarnedFrag);
        }
        return true;
    }

    /**
     * Handle game over for a player
     * @private
     */
    async _handleGameOver(playerIndex) {
        const roundOwner = captureLocalMultiplayerRound(this);
        if (!roundOwner) return;
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

        // Show death animation for the eliminated player, naming who did it
        this._showPlayerDeathAnimation(playerIndex, isSelfKill ? null : killerId);

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
                    if (!ownsLocalMultiplayerRound(this, roundOwner)) return;
                    await this._showMatchEnd({ type: 'team', teamId: teamOutcome.winnerTeamId });
                    return;
                }

                // If everyone died (draw), handle it
                if (teamOutcome && teamOutcome.isDraw) {
                    console.log('[LocalMultiplayer] Infinity Draw (all teams eliminated)');
                    await new Promise((resolve) => setTimeout(resolve, 1000));
                    if (!ownsLocalMultiplayerRound(this, roundOwner)) return;
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
                if (!ownsLocalMultiplayerRound(this, roundOwner)) return;
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

                await new Promise((resolve) => setTimeout(resolve, ROUND_OUTCOME_MS));
                if (!ownsLocalMultiplayerRound(this, roundOwner)) return;
                await this.handleRoundEnd({ type: 'team', teamId: teamOutcome.winnerTeamId });
            } else {
                console.log('[LocalMultiplayer] Round ended in a draw (no teams remaining)');
                await new Promise((resolve) => setTimeout(resolve, ROUND_OUTCOME_MS));
                if (!ownsLocalMultiplayerRound(this, roundOwner)) return;
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
            await new Promise((resolve) => setTimeout(resolve, ROUND_OUTCOME_MS));
            if (!ownsLocalMultiplayerRound(this, roundOwner)) return;

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
                    await new Promise((resolve) => setTimeout(resolve, ROUND_OUTCOME_MS));
                    if (!ownsLocalMultiplayerRound(this, roundOwner)) return;

                    await this.handleRoundEnd(winnerKey, isSelfKill);
                }
            }
            // If multiple players still alive, DO NOT pause - continue the match
        }
    }

    /**
     * The largest block that fits the window below the top row, and where each next
     * queue goes (src/ui/local-versus-layout.js). Kept for _updateBoardCSSVariables.
     * @private
     */
    _calculateDynamicBlockSize() {
        this.versusLayout = versusLayout({
            ...readVersusViewport(),
            players: this.matchConfig?.numPlayers || 2,
            infinity: Boolean(this.matchConfig?.isInfinityLMS),
        });
        return this.versusLayout.block;
    }

    /**
     * Hands the layout to keystone-versus.css: sizes as variables on the local stage
     * (scoped to it, so other modes' boards never inherit them).
     * @private
     */
    _updateBoardCSSVariables(blockSize) {
        if (!this.versusLayout) this._calculateDynamicBlockSize();
        applyVersusLayout(document.getElementById('multiplayer-container'), { ...this.versusLayout, block: blockSize });
    }

    /**
     * Create separate Phaser game instances for each player
     * @private
     */
    async _createSeparatePhaserGames() {
        return createLocalMultiplayerBoards(this);
    }

    _destroySeparatePhaserGames() {
        destroyLocalMultiplayerBoards(this);
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

            // The whole well moves: garbage meter, board and walls (keystone-versus.css).
            const container = document.getElementById(`p${i}-phaser-container`);
            const well = container?.closest('.player-board-wrapper');
            if (well) {
                this[`boardJuiceP${i}`] = new BoardJuice(well);
            }
        }
    }

    _setupLocalBots() {
        if (!this.multiplayerState) return;

        if (!this.botManager) {
            this.botManager = new LocalBotManager({
                actionFactory: (playerIndex) => this._createBotActions(playerIndex),
                multiplayerState: this.multiplayerState,
                rng: Math.random,
            });
        } else {
            this.botManager.destroy();
        }

        this.botManager.configure(this.matchConfig?.playerSlots || []);
    }

    _isBotPlayer(playerIndex) {
        return Boolean(this.botManager?.isBotPlayer(playerIndex));
    }

    _createBotActions(playerIndex) {
        const playerNum = playerIndex + 1;
        const getPlayerState = () => this.multiplayerState?.players?.[playerIndex];
        // main.js injects the ONE live callback builder. The mode's former local
        // fallback builder was dead code that fixes kept landing in — deleted.
        const getPhysicsCallbacks = () => this.deps.getMultiplayerPhysicsCallbacks?.(playerNum) || {};
        const playMove = () => this.deps.soundManager?.sfxPlayer?.playMove?.();
        const playRotate = () => this.deps.soundManager?.sfxPlayer?.playRotate?.();
        const playDrop = () => this.deps.soundManager?.sfxPlayer?.playDrop?.();

        return {
            moveLeft: () => {
                const playerState = getPlayerState();
                const moved = coreMove(playerState, -1, playMove);
                if (moved) this._applyBotBoardJuice(playerNum, 'move', -1);
                return moved;
            },
            moveRight: () => {
                const playerState = getPlayerState();
                const moved = coreMove(playerState, 1, playMove);
                if (moved) this._applyBotBoardJuice(playerNum, 'move', 1);
                return moved;
            },
            rotateLeft: () => {
                const playerState = getPlayerState();
                const rotated = coreRotate(playerState, 'left', playRotate);
                if (rotated) this._applyBotBoardJuice(playerNum, 'rotate', 'left');
                return rotated;
            },
            rotateRight: () => {
                const playerState = getPlayerState();
                const rotated = coreRotate(playerState, 'right', playRotate);
                if (rotated) this._applyBotBoardJuice(playerNum, 'rotate', 'right');
                return rotated;
            },
            rotateFlip: () => {
                const playerState = getPlayerState();
                const rotated = coreRotate(playerState, 'flip', playRotate);
                if (rotated) this._applyBotBoardJuice(playerNum, 'rotate', 'flip');
                return rotated;
            },
            softDrop: () => {
                const playerState = getPlayerState();
                return coreSoftDrop(playerState, playDrop, getPhysicsCallbacks());
            },
            hardDrop: () => {
                const playerState = getPlayerState();
                if (!playerState?.currentPiece) return false;
                coreHardDrop(playerState, playDrop, getPhysicsCallbacks());
                this._applyBotBoardJuice(playerNum, 'hardDrop');
                return true;
            },
        };
    }

    _applyBotBoardJuice(playerNum, action, value = null) {
        const juice = this[`boardJuiceP${playerNum}`];
        if (!juice) return;

        if (action === 'move') {
            juice.nudge(value * 0.5, 0);
        } else if (action === 'rotate') {
            const degrees = value === 'left' ? -1 : (value === 'flip' ? 2 : 1);
            juice.tilt(degrees * 1.5);
            juice.nudge(0, -0.5);
        } else if (action === 'hardDrop') {
            juice.dip(4);
            juice.bounce();
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
            move: window.move,
            rotate: window.rotate,
            hardDrop: window.hardDrop,
            hold: window.hold,
            moveP2: window.moveP2,
            rotateP2: window.rotateP2,
            hardDropP2: window.hardDropP2,
            holdP2: window.holdP2,
            moveP3: window.moveP3,
            rotateP3: window.rotateP3,
            hardDropP3: window.hardDropP3,
            holdP3: window.holdP3,
            moveP4: window.moveP4,
            rotateP4: window.rotateP4,
            hardDropP4: window.hardDropP4,
            holdP4: window.holdP4,
        };

        const wrapMove = (playerNum, origMove) => (dir) => {
            if (this._isBotPlayer(playerNum - 1)) return false;
            if (this.multiplayerState?.players?.[playerNum - 1]?.hitStopRemaining > 0) return false;
            let result = false;
            if (origMove) result = origMove(dir);
            const juice = this[`boardJuiceP${playerNum}`];
            if (juice) {
                juice.nudge(dir * 0.5, 0);
            }
            return result;
        };

        const wrapRotate = (playerNum, origRotate) => (dir) => {
            if (this._isBotPlayer(playerNum - 1)) return false;
            if (this.multiplayerState?.players?.[playerNum - 1]?.hitStopRemaining > 0) return false;
            const result = origRotate ? origRotate(dir) : false;
            const juice = this[`boardJuiceP${playerNum}`];
            if (juice) {
                const degrees = (dir === 'left' ? -1 : (dir === 'flip' ? 2 : 1));
                juice.tilt(degrees * 1.5);
                juice.nudge(0, -0.5);
            }
            return result;
        };

        const wrapHardDrop = (playerNum, origHardDrop) => () => {
            if (this._isBotPlayer(playerNum - 1)) return false;
            if (this.multiplayerState?.players?.[playerNum - 1]?.hitStopRemaining > 0) return false;
            const result = origHardDrop ? origHardDrop() : false;
            const juice = this[`boardJuiceP${playerNum}`];
            if (juice) {
                juice.dip(4);
                juice.bounce();
            }
            return result;
        };

        const wrapHold = (playerNum, origHold) => () => {
            if (this._isBotPlayer(playerNum - 1)) return false;
            if (this.multiplayerState?.players?.[playerNum - 1]?.hitStopRemaining > 0) return false;
            const result = origHold ? origHold() : false;
            const juice = this[`boardJuiceP${playerNum}`];
            if (juice) {
                juice.nudge(0, -0.5);
            }
            return result;
        };

        window.move = wrapMove(1, this._originalInputs.move);
        window.rotate = wrapRotate(1, this._originalInputs.rotate);
        window.hardDrop = wrapHardDrop(1, this._originalInputs.hardDrop);
        window.hold = wrapHold(1, this._originalInputs.hold);

        if (this._originalInputs.moveP2) window.moveP2 = wrapMove(2, this._originalInputs.moveP2);
        if (this._originalInputs.rotateP2) window.rotateP2 = wrapRotate(2, this._originalInputs.rotateP2);
        if (this._originalInputs.hardDropP2) window.hardDropP2 = wrapHardDrop(2, this._originalInputs.hardDropP2);
        if (this._originalInputs.holdP2) window.holdP2 = wrapHold(2, this._originalInputs.holdP2);

        if (this._originalInputs.moveP3) window.moveP3 = wrapMove(3, this._originalInputs.moveP3);
        if (this._originalInputs.rotateP3) window.rotateP3 = wrapRotate(3, this._originalInputs.rotateP3);
        if (this._originalInputs.hardDropP3) window.hardDropP3 = wrapHardDrop(3, this._originalInputs.hardDropP3);
        if (this._originalInputs.holdP3) window.holdP3 = wrapHold(3, this._originalInputs.holdP3);

        if (this._originalInputs.moveP4) window.moveP4 = wrapMove(4, this._originalInputs.moveP4);
        if (this._originalInputs.rotateP4) window.rotateP4 = wrapRotate(4, this._originalInputs.rotateP4);
        if (this._originalInputs.hardDropP4) window.hardDropP4 = wrapHardDrop(4, this._originalInputs.hardDropP4);
        if (this._originalInputs.holdP4) window.holdP4 = wrapHold(4, this._originalInputs.holdP4);
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
        window.hold = this._originalInputs.hold;

        if (this._originalInputs.moveP2 !== undefined) window.moveP2 = this._originalInputs.moveP2;
        if (this._originalInputs.rotateP2 !== undefined) window.rotateP2 = this._originalInputs.rotateP2;
        if (this._originalInputs.hardDropP2 !== undefined) window.hardDropP2 = this._originalInputs.hardDropP2;
        if (this._originalInputs.holdP2 !== undefined) window.holdP2 = this._originalInputs.holdP2;

        if (this._originalInputs.moveP3 !== undefined) window.moveP3 = this._originalInputs.moveP3;
        if (this._originalInputs.rotateP3 !== undefined) window.rotateP3 = this._originalInputs.rotateP3;
        if (this._originalInputs.hardDropP3 !== undefined) window.hardDropP3 = this._originalInputs.hardDropP3;
        if (this._originalInputs.holdP3 !== undefined) window.holdP3 = this._originalInputs.holdP3;

        if (this._originalInputs.moveP4 !== undefined) window.moveP4 = this._originalInputs.moveP4;
        if (this._originalInputs.rotateP4 !== undefined) window.rotateP4 = this._originalInputs.rotateP4;
        if (this._originalInputs.hardDropP4 !== undefined) window.hardDropP4 = this._originalInputs.hardDropP4;
        if (this._originalInputs.holdP4 !== undefined) window.holdP4 = this._originalInputs.holdP4;

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

    _hideMultiplayerBoardsForCountdown() {
        const container = document.getElementById('multiplayer-container');
        if (!container) return;

        container.style.transition = 'none';
        container.style.opacity = '0';
    }

    _revealMultiplayerBoardsForCountdown({ fadeMs = 260 } = {}) {
        const container = document.getElementById('multiplayer-container');
        if (!container) return;

        container.style.transition = `opacity ${fadeMs}ms ease-out`;

        requestAnimationFrame(() => {
            container.style.opacity = '1';
        });

        setTimeout(() => {
            if (container.isConnected) {
                container.style.transition = '';
            }
        }, fadeMs + 60);
    }

    /**
     * Resolve team/color data for multiplayer UI
     * @private
     */
    _getResolvedTeamId(playerIndex) {
        // Honor the raw team id (0..3); default to the player's own team (its
        // index) when unset. No 2-team clamp — supports up to TEAM_COLORS teams.
        const teamId = this.matchConfig?.playerTeams?.[playerIndex];
        const resolved = Number.isInteger(teamId) ? teamId : playerIndex;
        return Math.min(Math.max(resolved, 0), TEAM_COLORS.length - 1);
    }

    _getTeamColorScheme(teamId) {
        return TEAM_COLORS[teamId % TEAM_COLORS.length] || TEAM_COLORS[0];
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
        return `Team ${String.fromCharCode(65 + (teamId % 26))}`;
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
        this.teamRoundWins[teamId] = (this.teamRoundWins[teamId] || 0) + 1;
        this._syncTeamRoundWins(teamId);
        return this.teamRoundWins[teamId];
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

        // Each seat's hue (its team's in team play) for keystone-versus.css: the plate,
        // the board frame and the queue's first tile.
        for (let i = 1; i <= numPlayers; i++) {
            const scheme = this._getPlayerColorScheme(i - 1);
            const primary = scheme?.primary || '#3b82f6';
            const playerCard = document.getElementById(`player-${i}-card`);
            if (playerCard) {
                playerCard.style.setProperty('--player-primary', primary);
                playerCard.style.setProperty('--player-primary-light', scheme?.light || primary);
                playerCard.style.setProperty('--player-glow', scheme?.glow || `${primary}80`);
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
            // Frags and time limits go to the leader, not necessarily the round's winner:
            // the most frags, or the highest score when time runs out (the setup sheet's
            // rule, and what the plates rank by).
            let matchWinner = winner;
            const leaderKey = { frags: 'frags', time: 'score' }[this.matchConfig?.endCondition];
            if (leaderKey) {
                let best = -1;
                this._matchTotals().forEach((totals, i) => {
                    if (totals[leaderKey] > best) {
                        best = totals[leaderKey];
                        matchWinner = `player${i + 1}`;
                    }
                });
            }
            console.log(`[LocalMultiplayer] ${winnerName} wins the match!`);
            await this._showMatchEnd(matchWinner);
            return;
        }

        // Quadra-style: instant restart; the banner names the round's winner as it begins.
        this._roundOutcome = { winnerIndex, selfKill: isSelfKill };
        console.log(`[LocalMultiplayer] Starting next round... Winner: ${winnerName}, Wins: ${winnerWins}`);
        // Removed _showRoundEnd delay for instant transition
        await this._startNewRound();
    }

    async _handleTeamRoundEnd(teamId) {
        const teamName = this._getTeamLabel(teamId);

        console.log(`[LocalMultiplayer] Round ended! Winner: ${teamName}`);

        const teamWins = this._recordTeamRoundWin(teamId);
        const wonMatch = this._checkTeamMatchWinCondition(teamId);

        if (wonMatch) {
            // A timed match goes to the team with the highest score, as the setup sheet says.
            const winnerTeam = this.matchConfig?.endCondition === 'time' ? this._leadingTeamByScore() : teamId;
            console.log(`[LocalMultiplayer] ${this._getTeamLabel(winnerTeam)} wins the match!`);
            await this._showMatchEnd({ type: 'team', teamId: winnerTeam });
            return;
        }

        console.log(`[LocalMultiplayer] Starting next round... Winner: ${teamName}, Wins: ${teamWins}`);
        this._roundOutcome = { teamId };
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
            const numFragPlayers = config.numPlayers || 2;
            for (let fi = 0; fi < numFragPlayers; fi++) {
                const matchKey = `player${fi + 1}`;
                const cumulative = (this.matchStats[matchKey]?.frags || 0) + (this.multiplayerState.frags[fi] ?? 0);
                if (cumulative >= config.endConditionValue) return true;
            }
            return false;
        }

        case 'time': {
            const elapsedMinutes = (Date.now() - this.matchStartTime) / 1000 / 60;
            return elapsedMinutes >= config.endConditionValue;
        }

        case 'points': {
            const targetScore = config.endConditionValue * 1000;
            return this.multiplayerState.players.some((player, playerIndex) => {
                const matchKey = `player${playerIndex + 1}`;
                return (this.matchStats[matchKey]?.score || 0) + (player?.score || 0) >= targetScore;
            });
        }

        case 'lines': {
            return this.multiplayerState.players.some((player, playerIndex) => {
                const matchKey = `player${playerIndex + 1}`;
                return (this.matchStats[matchKey]?.lines || 0)
                    + (player?.totalLinesCleared || 0) >= config.endConditionValue;
            });
        }

        case 'never':
            // Never end automatically
            return false;

        default:
            return this.roundWins[lastRoundWinner] >= config.endConditionValue;
        }
    }

    /**
     * Start a new round
     * @private
     */
    async _startNewRound(seed) {
        console.log('[LocalMultiplayer] Starting new round...');

        const retiredRound = retireLocalMultiplayerRound(this);
        if (!await drainLocalMultiplayerRound(this, retiredRound) || !this.isRunning) return;

        // Clear death animations from previous round
        this._clearDeathAnimations();
        this.versusHud?.announceRound(this.versusRound || 1, this._roundOutcome || null);
        this._roundOutcome = null;
        this.versusRound = (this.versusRound || 1) + 1;

        // Aggregate current round stats into match totals BEFORE resetting logic
        const { numPlayers } = this.multiplayerState;
        const roundDuration = retiredRound.clock.usesFixedTiming
            ? retiredRound.clock.roundMs
            : Date.now() - (this.roundStartTime || this.matchStartTime);

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

            // Aggregate combat/advanced metrics across rounds (reset per round in MultiPlayerState)
            if (!this.matchStats[matchKey].metrics) {
                this.matchStats[matchKey].metrics = this._emptyMatchMetrics();
            }
            this._accumulateMatchMetrics(
                this.matchStats[matchKey].metrics,
                this.multiplayerState.getPlayerMetrics(i),
            );

            accumulatedLog[matchKey] = this.matchStats[matchKey];
        }

        console.log('[LocalMultiplayer] Match stats accumulated:', accumulatedLog);

        // Reset multiplayer state
        this.multiplayerState.reset();
        this.multiplayerState.setPlayerHandicaps(this.matchConfig?.playerHandicaps);
        this.multiplayerState.isPaused = true;

        this._initializeSharedPieceRng(seed);

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
        this._setupLocalBots();

        // Start game loop
        this.multiplayerState.isPaused = false;
        this.multiplayerState.lastTime = performance.now();
        console.log('[LocalMultiplayer] Starting game loop...');
        this._startGameLoop();

        console.log('[LocalMultiplayer] New round started!');
        this.roundStartTime = Date.now();
    }

    /**
     * Empty aggregate-metrics record used for end-of-match stats.
     * @private
     */
    _emptyMatchMetrics() {
        return createEmptyMatchMetrics();
    }

    /**
     * Accumulate one round's player metrics into a running match-total record.
     * Delegates to the pure `match-metrics` helper. Additive fields are summed;
     * max-style fields take the maximum.
     * @private
     */
    _accumulateMatchMetrics(target, src = {}) {
        return accumulateMatchMetrics(target, src);
    }

    async _showMatchEnd(winner) {
        let winnerName = 'Player 1';
        let winnerIndex = -1;
        const teamWin = winner && typeof winner === 'object' && winner.type === 'team';
        if (winner === 'draw') {
            winnerName = 'Draw';
        } else if (teamWin) {
            winnerName = this._getTeamLabel(winner.teamId);
        } else if (typeof winner === 'string') {
            winnerIndex = parseInt(winner.replace('player', ''), 10) - 1;
            winnerName = `Player ${winnerIndex + 1}`;
        }
        const { numPlayers } = this.multiplayerState;

        console.log(`[LocalMultiplayer] Match ended! Winner: ${winnerName}`);

        const clockBeforeStop = captureLocalMultiplayerClock(this);
        const winners = teamWin
            ? this.multiplayerState.players.map((_, i) => i).filter((i) => this._getResolvedTeamId(i) === winner.teamId)
            : [winnerIndex].filter((i) => i >= 0);
        if (winners.length && !(await this._playVictoryBeat(winners))) return;
        await this.onStop();
        const resultGeneration = this._startGeneration;
        // Captured before the victory beat and the teardown, in both lanes: a match's
        // rates count its play, not the celebration (ADR-0012).
        const resultClock = clockBeforeStop;
        this.lastMatchResultClock = resultClock;

        const currentDuration = resultClock.roundMs;
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

            // Combat/advanced metrics: previous rounds (matchStats) + current round (live)
            const metrics = this._accumulateMatchMetrics(this._emptyMatchMetrics(), stats.metrics || {});
            this._accumulateMatchMetrics(metrics, this.multiplayerState.getPlayerMetrics(i));

            const seconds = Math.max(totalDuration / 1000, 0.001);
            const pps = (totalPieces / seconds).toFixed(2);
            const apm = Math.round((metrics.attacksSent || 0) / minutes);

            players.push({
                name: this.matchConfig?.playerSlots?.[i]?.name || `Player ${i + 1}`,
                color: this._getPlayerColorScheme(i)?.primary,
                isWinner: teamWin ? this._getResolvedTeamId(i) === winner.teamId : i === winnerIndex,
                score: finalScore,
                lines: finalLines,
                deaths: finalDeaths,
                frags,
                bpm,
                ppm,
                pps,
                apm,
                attacksSent: metrics.attacksSent,
                attackLinesSent: metrics.attackLinesSent,
                cleanLinesSent: metrics.cleanLinesSent,
                maxCombo: metrics.maxComboComplexity,
                maxDepth: metrics.maxComboDepth,
                potatoPasses: metrics.potatoPasses,
                potatoHits: metrics.potatoDetonations,
                pieces,
                clears,
            });
        }

        // Only show Hot Potato rows if the mode was actually played this match
        const potatoPlayed = players.some((p) => ((p.potatoPasses || 0) + (p.potatoHits || 0)) > 0);
        const ownsResult = () => this.isActive && this._startGeneration === resultGeneration;
        showLocalMatchEnd({
            title: winner === 'draw' ? 'A draw' : `${players[winnerIndex]?.name || winnerName} wins`,
            winCondition: versusGoal(this.matchConfig || {}),
            players,
            potatoPlayed,
            onPlayAgain: () => {
                if (!ownsResult()) return;
                this.onStart().catch((error) => {
                    console.error('[LocalMultiplayer] Match restart failed:', error);
                });
            },
            onMainMenu: () => {
                if (!ownsResult()) return;
                // Reset round wins
                this.roundWins.player1 = 0;
                this.roundWins.player2 = 0;
                this.roundWins.player3 = 0;
                this.roundWins.player4 = 0;
                this.teamRoundWins = {};
                eventBus.emit(EVENTS.EXIT_TO_MAIN_MENU);
            },
        });
    }

    /**
     * A knock-out: the stack goes dark, loses its colour and comes apart
     * (shared-effects.js playKnockout), and the knock-out card rises over it.
     * @private
     */
    _showPlayerDeathAnimation(playerIndex, by = null) {
        const boardScene = this.boardScenes[playerIndex];
        if (boardScene?.sharedEffects) boardScene.sharedEffects.playKnockout();
        else boardScene?.cameras?.main?.setAlpha(0.3);
        this.versusHud?.showKnockout(playerIndex, by);
        if (!this.knockedOut) this.knockedOut = new Set();
        this.knockedOut.add(playerIndex);
    }

    /**
     * Clear the knock-out cards and bring every board's colour and light back
     * (a new round or match).
     * @private
     */
    _clearDeathAnimations() {
        this.boardScenes.forEach((scene, index) => {
            if (this.knockedOut?.has(index)) scene?.sharedEffects?.clearKnockout?.();
            scene?.cameras?.main?.setAlpha?.(1.0);
        });
        this.knockedOut = new Set();
        this.versusHud?.clearKnockouts();
    }

    /**
     * The match's last beat on the boards: each winner's well celebrates (light
     * from the floor, fireworks, a glow behind it), the others dim, and the HUD
     * crowns the winner. Then the results.
     * @param {number[]} winners
     * @returns {Promise<boolean>} false when the match was left meanwhile
     * @private
     */
    async _playVictoryBeat(winners) {
        const generation = this._startGeneration;
        // The match is decided: the boards hold still under the celebration (a
        // timed or points match ends with every player still playing).
        if (this.multiplayerState) this.multiplayerState.isPaused = true;
        this.boardScenes.forEach((scene, i) => {
            if (winners.includes(i)) scene?.sharedEffects?.playVictory?.({ color: this._getPlayerColorScheme(i)?.primary });
            else scene?.cameras?.main?.setAlpha?.(0.4);
        });
        this.versusHud?.showVictory?.(winners);
        await new Promise((resolve) => { setTimeout(resolve, VICTORY_BEAT_MS); });
        this.versusHud?.clearVictory?.();
        return this.isActive && this._startGeneration === generation;
    }

    /**
     * A round won: the winner's well lights from the floor and fireworks go up
     * (shared-effects.js playRoundWin).
     * @private
     */
    _showVictoryAnimation(winnerIndex) {
        const color = this._getPlayerColorScheme(winnerIndex)?.primary;
        this.boardScenes[winnerIndex]?.sharedEffects?.playRoundWin?.({ color });
    }
}
