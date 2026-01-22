import Phaser from 'phaser';
import { BaseGameMode } from './BaseGameMode.js';
import {
    GAME_MODES, COLS, ROWS, BLOCK_SIZE,
} from '../constants.js';
import { SteamNetworking } from '../steam/steam-networking.js';
import { FFAGameStateP2P } from '../multiplayer/ffa-p2p-game-state.js';
import { LobbyBrowser } from '../../ui/lobby-browser.js';
import { LobbyWaitingRoom } from '../../ui/lobby-waiting-room.js';
import { MatchConfigModal } from '../../ui/match-config-modal.js';
import { MatchResultsModal } from '../../ui/match-results-modal.js';
import { onMultiplayerEvent, MULTIPLAYER_EVENTS } from '../../events/multiplayer-events.js';
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { OpponentWatchManager } from '../../ui/opponent-watch-manager.js';
import { OnlineScoreboard } from '../../ui/online-scoreboard.js';
import { OnlineKillFeed } from '../../ui/online-kill-feed.js';
import { OnlineChat } from '../../ui/online-chat.js';
import { MultiplayerScoreboardOverlay } from '../../ui/multiplayer-scoreboard-overlay.js';
import { NetworkQosHud } from '../../ui/network-qos.js';
import { updateNextQueue } from '../../ui/next-queue-ui.js';
import { MessageTypes } from '../network/message-types.js';

/**
 * OnlineMultiplayerMode - Online FFA multiplayer mode with lobby system
 *
 * Manages the complete online multiplayer flow:
 * 1. Initialize Steam networking
 * 2. Show lobby browser to browse/create/join lobbies
 * 3. Show waiting room for players to ready up
 * 4. Start the FFA match when all players are ready
 * 5. Handle match completion and return to lobby
 */
export class OnlineMultiplayerMode extends BaseGameMode {
    constructor(dependencies) {
        super(dependencies);

        // Networking
        this.steamNetworking = null;
        this.ffaGameState = null;

        // UI Components
        this.lobbyBrowser = null;
        this.lobbyWaitingRoom = null;
        this.matchConfigModal = null;
        this.matchResultsModal = null;

        // State
        this.currentLobbyId = null;
        this.isInMatch = false;

        // Game rendering
        this.mainPhaserGame = null;
        this.mainBoardScene = null;
        this.opponentWatchManager = null;
        this.scoreboard = null;
        this.scoreboardOverlay = null;
        this.killFeed = null;
        this.chat = null;
        this.qosHud = null;
        this.gameLoopId = null;
        this.lastSyncTime = 0;
        this.matchStartedUnsub = null;
        this.matchResultsUnsub = null;
        this.renderFrameUnsub = null;
        this.networkHandlersRegistered = false;
        this.lastPlayerSignature = '';
        this.originalInputs = {};
        this.playerColors = new Map();
        this.garbageFlashTimers = {};
        this.scoreboardToggleHandler = null;
        this.networkStats = null;
        this.snapshotStats = null;
        this.pingInterval = null;

        // Cleanup handlers
        this.cleanupHandlers = [];
    }

    getModeId() {
        return GAME_MODES.ONLINE_MULTIPLAYER;
    }

    getDisplayName() {
        return 'Online Multiplayer (FFA)';
    }

    /**
     * Called when online multiplayer mode is selected
     */
    async onActivate() {
        await super.onActivate();

        console.log('[OnlineMultiplayer] Activating online multiplayer mode...');

        // Hide both single player and local multiplayer containers
        const singlePlayerContainer = document.getElementById('single-player-container');
        if (singlePlayerContainer) {
            singlePlayerContainer.style.display = 'none';
        }

        // Hide single player stats bar
        const statsBar = document.querySelector('.single-player-stats-bar');
        if (statsBar) {
            statsBar.style.display = 'none';
        }

        const multiplayerContainer = document.getElementById('multiplayer-container');
        if (multiplayerContainer) {
            multiplayerContainer.style.display = 'none';
        }

        try {
            // Initialize Steam networking
            await this.initializeSteamNetworking();

            // Always create fresh lobby UI components
            if (this.lobbyBrowser) {
                this.lobbyBrowser.destroy();
            }
            if (this.matchConfigModal) {
                this.matchConfigModal.destroy();
            }

            // Initialize lobby UI components
            this.initializeLobbyUI();
            this._ensureMatchResultsModal();

            // Show lobby browser
            await this.showLobbyBrowser();

            console.log('[OnlineMultiplayer] ✅ Mode activated successfully');
        } catch (error) {
            console.error('[OnlineMultiplayer] Failed to activate:', error);
            alert(`Failed to initialize online multiplayer: ${error.message}`);
            throw error;
        }
    }

    /**
     * Initialize Steam networking
     */
    async initializeSteamNetworking() {
        if (this.steamNetworking) {
            console.log('[OnlineMultiplayer] Steam already initialized');
            return;
        }

        console.log('[OnlineMultiplayer] Initializing Steam networking...');

        this.steamNetworking = new SteamNetworking();
        const success = await this.steamNetworking.init();

        if (!success) {
            throw new Error('Failed to initialize Steam networking');
        }

        console.log('[OnlineMultiplayer] ✅ Steam networking initialized');
    }

    /**
     * Initialize lobby UI components
     */
    initializeLobbyUI() {
        if (!this.steamNetworking) {
            throw new Error('Steam networking must be initialized first');
        }

        console.log('[OnlineMultiplayer] Initializing lobby UI...');

        // Create lobby browser with cancel callback
        this.lobbyBrowser = new LobbyBrowser(
            this.steamNetworking,
            (lobbyId) => this.handleJoinLobby(lobbyId),
            () => this.showMatchConfigModal(),
            () => this.handleLobbyBrowserCancelled(),
        );

        // Create match config modal
        this.matchConfigModal = new MatchConfigModal(
            (config) => this.handleCreateLobby(config),
        );

        console.log('[OnlineMultiplayer] ✅ Lobby UI initialized');
    }

    /**
     * Initialize match results modal and listeners
     */
    _ensureMatchResultsModal() {
        if (!this.matchResultsModal) {
            this.matchResultsModal = new MatchResultsModal({
                onPlayAgain: () => this._handlePlayAgain(),
                onReturnToLobby: () => this._handleReturnToLobby(),
                onExit: () => this._handleExitToMenu(),
            });
        }

        if (!this.matchResultsUnsub) {
            this.matchResultsUnsub = onMultiplayerEvent(
                MULTIPLAYER_EVENTS.GAME_OVER,
                (detail) => this._handleMatchResults(detail),
            );
            this.cleanupHandlers.push(this.matchResultsUnsub);
        }
    }

    /**
     * Show lobby browser
     */
    async showLobbyBrowser() {
        if (!this.lobbyBrowser) {
            throw new Error('Lobby browser not initialized');
        }

        console.log('[OnlineMultiplayer] Showing lobby browser...');
        await this.lobbyBrowser.show();
    }

    /**
     * Called when lobby browser is cancelled
     */
    async handleLobbyBrowserCancelled() {
        console.log('[OnlineMultiplayer] Lobby browser cancelled, returning to start modal');
        console.log('[OnlineMultiplayer] Current mode state - isActive:', this.isActive, 'isRunning:', this.isRunning);

        // Manually deactivate this mode since we can't access gameModeManager
        // (gameModeManager is not in deps to avoid circular dependency)
        console.log('[OnlineMultiplayer] Manually resetting mode state...');
        this.isActive = false;
        this.isRunning = false;
        this.isPaused = false;

        // Show intro animation background with logo
        const { introAnimation } = await import('../../ui/intro-animation.js');
        if (introAnimation && this.deps.soundManager) {
            introAnimation.showBackgroundOnly(this.deps.soundManager);
        }

        // Show start modal
        if (this.deps.modalManager) {
            this.deps.modalManager.show('start');
        }

        console.log('[OnlineMultiplayer] handleLobbyBrowserCancelled complete - mode reset');
    }

    /**
     * Handle joining a lobby
     */
    async handleJoinLobby(lobbyId) {
        try {
            console.log(`[OnlineMultiplayer] Joining lobby: ${lobbyId}`);

            // Join the lobby via Steam
            await this.steamNetworking.joinLobby(lobbyId);

            // Create FFA game state as peer
            this.ffaGameState = new FFAGameStateP2P(
                this.steamNetworking,
                this.steamNetworking.steamId,
            );

            // Announce join to host
            this.ffaGameState.announceJoin();

            this.currentLobbyId = lobbyId;

            // Show waiting room
            this.showWaitingRoom();

            console.log('[OnlineMultiplayer] ✅ Joined lobby successfully');
        } catch (error) {
            console.error('[OnlineMultiplayer] Failed to join lobby:', error);
            alert(`Failed to join lobby: ${error.message}`);
        }
    }

    /**
     * Show match configuration modal
     */
    showMatchConfigModal() {
        if (!this.matchConfigModal) {
            console.error('[OnlineMultiplayer] Match config modal not initialized');
            return;
        }

        this.matchConfigModal.show();
    }

    /**
     * Handle creating a new lobby with custom configuration
     */
    async handleCreateLobby(config) {
        try {
            console.log('[OnlineMultiplayer] Creating new lobby with config:', config);

            // Create lobby via Steam
            const lobbyId = await this.steamNetworking.createLobby(config);

            // Create FFA game state as host
            this.ffaGameState = new FFAGameStateP2P(
                this.steamNetworking,
                this.steamNetworking.steamId,
            );

            // Set match configuration
            this.ffaGameState.matchConfig = {
                endCondition: config.endCondition,
                endConditionValue: config.endConditionValue,
                startLevel: 1,
                levelProgression: false,
                allowHandicap: true,
                boringRules: config.boringRules || false,
                maxPlayers: config.maxPlayers,
            };

            this.currentLobbyId = lobbyId;

            // Show waiting room
            this.showWaitingRoom();

            console.log(`[OnlineMultiplayer] ✅ Lobby created: ${lobbyId}`);
        } catch (error) {
            console.error('[OnlineMultiplayer] Failed to create lobby:', error);
            alert(`Failed to create lobby: ${error.message}`);
        }
    }

    /**
     * Show waiting room
     */
    showWaitingRoom() {
        if (!this.ffaGameState) {
            throw new Error('Game state not initialized');
        }

        console.log('[OnlineMultiplayer] Showing waiting room...');

        // Create waiting room UI if not already created
        if (!this.lobbyWaitingRoom) {
            this.lobbyWaitingRoom = new LobbyWaitingRoom(
                this.ffaGameState,
                () => this.handleMatchStart(),
                () => this.handleLeaveLobby(),
            );
        } else {
            // Update game state reference
            this.lobbyWaitingRoom.gameState = this.ffaGameState;
        }

        // Show waiting room
        this.lobbyWaitingRoom.show();

        // Listen for match start event (for peers)
        if (!this.matchStartedUnsub) {
            this.matchStartedUnsub = onMultiplayerEvent(
                MULTIPLAYER_EVENTS.MATCH_STARTED,
                () => this.handleMatchStart(),
            );
            this.cleanupHandlers.push(this.matchStartedUnsub);
        }

        console.log('[OnlineMultiplayer] ✅ Waiting room shown');
    }

    /**
     * Handle leaving lobby
     */
    handleLeaveLobby() {
        console.log('[OnlineMultiplayer] Handling lobby leave...');
        if (this.matchResultsModal) {
            this.matchResultsModal.hide();
        }

        // Leave current lobby via Steam
        if (this.currentLobbyId && this.steamNetworking) {
            console.log('[OnlineMultiplayer] Leaving Steam lobby...');
            this.steamNetworking.leaveLobby();
            this.currentLobbyId = null;
        }

        // Cleanup game state
        if (this.ffaGameState) {
            this.ffaGameState.cleanup();
            this.ffaGameState = null;
        }

        // Show lobby browser again
        console.log('[OnlineMultiplayer] Returning to lobby browser...');
        this.showLobbyBrowser();
    }

    /**
     * Handle match start - Initialize game rendering
     */
    async handleMatchStart() {
        console.log('[OnlineMultiplayer] Match starting...');
        this.lastNextPieceIds = '';
        if (this.matchResultsModal) {
            this.matchResultsModal.hide();
        }

        if (this.isInMatch) {
            console.log('[OnlineMultiplayer] Match already running, skipping duplicate start');
            return;
        }

        // Hide waiting room
        if (this.lobbyWaitingRoom) {
            this.lobbyWaitingRoom.hide();
        }

        // Clear any death overlays from previous match
        this._clearDeathState();

        // Hide other containers
        this._hideOtherContainers();

        // Show online multiplayer container
        const container = document.getElementById('online-multiplayer-container');
        if (container) {
            container.style.display = 'grid';
        }

        // Create main board (Phaser) for local player
        await this._createMainBoard();

        // Create opponent watch manager
        this._createOpponentBoards();

        // Initialize right panel (scoreboard, kill feed, chat)
        this._initializeRightPanel();

        // Register network handlers for state sync
        this._registerNetworkHandlers();

        // Set up input handlers
        this._setupInputHandlers();
        this._setupScoreboardOverlayHotkey();

        // Start game loop
        this.isInMatch = true;
        this._registerNetworkHandlers();
        this._hookInputs();

        console.log('[OnlineMultiplayer] ✅ Match started, rendering initialized');
    }

    /**
     * Handle match results (game over)
     */
    _handleMatchResults(detail) {
        if (!detail || detail.isGameOver !== true) {
            return;
        }

        if (this.matchResultsModal && this.matchResultsModal.isVisible) {
            return;
        }

        this._cleanupGameRendering();
        this.isInMatch = false;

        if (this.matchResultsModal) {
            this.matchResultsModal.show(detail, {
                isHost: this.steamNetworking?.isHost,
                localPlayerId: this.steamNetworking?.steamId,
            });
        }
    }

    /**
     * Play again (host only)
     */
    _handlePlayAgain() {
        if (!this.ffaGameState || !this.steamNetworking?.isHost) {
            return;
        }

        if (this.matchResultsModal) {
            this.matchResultsModal.hide();
        }

        this.ffaGameState.restartFullGame();
    }

    /**
     * Return to lobby waiting room
     */
    _handleReturnToLobby() {
        if (this.matchResultsModal) {
            this.matchResultsModal.hide();
        }

        this._cleanupGameRendering();
        this.isInMatch = false;

        if (this.ffaGameState) {
            this.ffaGameState.gamePhase = 'waiting';
            this.ffaGameState.winner = null;
            if (this.ffaGameState.resetReadyStates) {
                this.ffaGameState.resetReadyStates();
            }
        }

        this.showWaitingRoom();
    }

    /**
     * Exit to main menu
     */
    async _handleExitToMenu() {
        if (this.matchResultsModal) {
            this.matchResultsModal.hide();
        }

        await this.onDeactivate();

        const { introAnimation } = await import('../../ui/intro-animation.js');
        if (introAnimation && this.deps.soundManager) {
            introAnimation.showBackgroundOnly(this.deps.soundManager);
        }

        if (this.deps.modalManager) {
            this.deps.modalManager.show('start');
        }
    }

    /**
     * Hide other game containers
     */
    _hideOtherContainers() {
        const containers = [
            'single-player-container',
            'multiplayer-container',
            'odyssey-container',
        ];
        containers.forEach((id) => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });

        // Also hide stats bars
        const statsBar = document.querySelector('.single-player-stats-bar');
        if (statsBar) statsBar.style.display = 'none';
    }

    /**
     * Create main Phaser board for local player
     */
    async _createMainBoard() {
        const container = document.getElementById('online-main-board');
        if (!container) {
            throw new Error('Main board container not found');
        }

        // Import BoardScene dynamically using factory function
        const { createBoardScene } = await import('../../rendering/phaser/board-scene.js');
        const BoardScene = createBoardScene(Phaser);

        // Use fixed internal resolution for consistent rendering
        // This matches how LocalMultiplayerMode handles it
        const FIXED_BLOCK_SIZE = 40;
        const internalWidth = COLS * FIXED_BLOCK_SIZE;  // 10 * 40 = 400
        const internalHeight = ROWS * FIXED_BLOCK_SIZE; // 20 * 40 = 800

        // Create Phaser game for local player
        // Use Scale.NONE and let CSS handle sizing - matches single player approach
        this.mainPhaserGame = new Phaser.Game({
            type: Phaser.WEBGL,
            parent: container,
            width: internalWidth,
            height: internalHeight,
            transparent: true,
            scene: BoardScene,
            scale: {
                mode: Phaser.Scale.NONE,
                autoCenter: Phaser.Scale.NO_CENTER,
                width: internalWidth,
                height: internalHeight,
            },
            render: {
                pixelArt: true,
            },
        });

        // Wait for scene to be ready
        return new Promise((resolve) => {
            this.mainPhaserGame.events.once('ready', () => {
                this.mainBoardScene = this.mainPhaserGame.scene.getScene('BoardScene');
                console.log('[OnlineMultiplayer] Main board scene ready');
                resolve();
            });
        });
    }

    /**
     * Create opponent watch manager for mini-boards
     */
    _createOpponentBoards() {
        const watchGrid = document.getElementById('watch-grid');
        if (!watchGrid) {
            console.warn('[OnlineMultiplayer] Watch grid not found');
            return;
        }

        this.opponentWatchManager = new OpponentWatchManager(watchGrid);
        this.opponentWatchManager.setLocalPlayer(this.steamNetworking.steamId);

        // Set initial players from game state
        if (this.ffaGameState && this.ffaGameState.players) {
            const rawPlayers = Array.from(this.ffaGameState.players.values());
            this._syncPlayerColors(rawPlayers);
            const players = rawPlayers.map((p) => ({
                id: p.steamId,
                name: p.name,
                isAlive: p.isAlive !== false,
                frags: p.frags || 0,
                grid: p.gameState?.boardGrid || p.gameState?.grid,
                currentPiece: p.gameState?.currentPiece,
            }));
            this.opponentWatchManager.setPlayers(players);
        }

        // Auto-watch button handler
        const autoWatchBtn = document.getElementById('auto-watch-btn');
        if (autoWatchBtn) {
            autoWatchBtn.onclick = () => this.opponentWatchManager.autoSelectOpponents();
        }

        console.log('[OnlineMultiplayer] Opponent watch manager created');
    }

    /**
     * Initialize right panel components
     */
    _initializeRightPanel() {
        // Scoreboard
        const scoreboardContainer = document.getElementById('online-scoreboard');
        if (scoreboardContainer) {
            this.scoreboard = new OnlineScoreboard(scoreboardContainer);
            this.scoreboard.setLocalPlayer(this.steamNetworking.steamId);

            if (this.ffaGameState?.matchConfig) {
                this.scoreboard.setGoal(
                    this.ffaGameState.matchConfig.endCondition,
                    this.ffaGameState.matchConfig.endConditionValue,
                );
            }
        }

        if (!this.scoreboardOverlay) {
            this.scoreboardOverlay = new MultiplayerScoreboardOverlay();
            this.scoreboardOverlay.setLocalPlayer(this.steamNetworking.steamId);
            if (this.ffaGameState?.matchConfig) {
                this.scoreboardOverlay.setGoal(
                    this.ffaGameState.matchConfig.endCondition,
                    this.ffaGameState.matchConfig.endConditionValue,
                );
            }
        }

        // Kill feed
        const killFeedContainer = document.getElementById('online-kill-feed');
        if (killFeedContainer) {
            this.killFeed = new OnlineKillFeed(killFeedContainer);
        }

        // Chat
        const chatContainer = document.querySelector('.online-chat');
        if (chatContainer) {
            this.chat = new OnlineChat(chatContainer, (text) => {
                // Send chat message via network
                this._sendChatMessage(text);
            });
            this.chat.addSystemMessage('Match started! Good luck!');
        }

        if (!this.qosHud) {
            const parent = document.getElementById('online-multiplayer-container') || document.body;
            this.qosHud = new NetworkQosHud(parent);
        }
        this._updateNetworkHud();

        console.log('[OnlineMultiplayer] Right panel initialized');
    }

    /**
     * Register network handlers for state sync
     */
    _registerNetworkHandlers() {
        if (this.networkHandlersRegistered || !this.steamNetworking) {
            return;
        }

        this.renderFrameUnsub = onMultiplayerEvent(
            MULTIPLAYER_EVENTS.RENDER_FRAME,
            (detail) => this._handleRenderFrame(detail),
        );
        this.cleanupHandlers.push(this.renderFrameUnsub);

        const fragHandler = (msg) => {
            this.scoreboard?.highlightPlayer?.(msg.data.killer);
        };

        const deathHandler = (msg) => {
            this._handlePlayerDeath(msg.data);
        };

        const garbageHandler = (msg) => {
            if (!this.killFeed) return;
            const targetLabel = msg.data.targetCount === 1
                ? '1 player'
                : `${msg.data.targetCount || 0} players`;
            const senderColor = this._getPlayerColor(msg.data.from);
            this.killFeed.addGarbageSent({
                sender: msg.data.fromName,
                target: targetLabel,
                lines: msg.data.totalLines || 0,
                senderColor,
            });
            if (msg.data.from && msg.data.from === this.steamNetworking?.steamId) {
                this._flashGarbageIndicator('outgoing', 400);
            }
        };

        const chatHandler = (msg) => {
            if (!this.chat) return;
            this.chat.addMessage({
                author: msg.data.playerName || msg.data.author,
                text: msg.data.message || msg.data.text,
            });
        };

        this.steamNetworking.on(MessageTypes.GAME_PLAYER_FRAG, fragHandler);
        this.steamNetworking.on(MessageTypes.GAME_PLAYER_DIED, deathHandler);
        this.steamNetworking.on(MessageTypes.GAME_GARBAGE_SENT, garbageHandler);
        this.steamNetworking.on('game:chat', chatHandler);

        this.cleanupHandlers.push(() => {
            this.steamNetworking.off(MessageTypes.GAME_PLAYER_FRAG, fragHandler);
            this.steamNetworking.off(MessageTypes.GAME_PLAYER_DIED, deathHandler);
            this.steamNetworking.off(MessageTypes.GAME_GARBAGE_SENT, garbageHandler);
            this.steamNetworking.off('game:chat', chatHandler);
        });

        if (!this.networkStats) {
            this.networkStats = {
                rttMs: this.steamNetworking?.isHost ? 0 : null,
                lossPct: 0,
                snapshotRate: null,
                route: this.steamNetworking?.mockMode ? 'Mock' : 'Steam',
            };
        }
        if (!this.snapshotStats) {
            this.snapshotStats = {
                count: 0,
                drops: 0,
                lastAt: null,
                avgInterval: null,
            };
        }

        const snapshotHandler = (msg) => {
            if (this.steamNetworking?.isHost) return;
            const now = Date.now();
            const expectedInterval = 1000 / (this.ffaGameState?.STATE_SYNC_RATE || 30);

            if (this.snapshotStats.lastAt) {
                const delta = now - this.snapshotStats.lastAt;
                if (delta > expectedInterval * 1.5) {
                    this.snapshotStats.drops += 1;
                }
                this.snapshotStats.avgInterval = this.snapshotStats.avgInterval
                    ? (this.snapshotStats.avgInterval * 0.8 + delta * 0.2)
                    : delta;
            }

            this.snapshotStats.lastAt = now;
            this.snapshotStats.count += 1;

            if (this.snapshotStats.avgInterval) {
                this.networkStats.snapshotRate = 1000 / this.snapshotStats.avgInterval;
            }
            if (msg.timestamp) {
                this.networkStats.rttMs = Math.max(0, now - msg.timestamp);
            }
            this.networkStats.lossPct = this.snapshotStats.count > 0
                ? (this.snapshotStats.drops / this.snapshotStats.count) * 100
                : 0;

            this._updateNetworkHud();
        };

        const pingHandler = (msg) => {
            if (!this.steamNetworking?.isHost) return;
            if (!msg?.data?.sentAt) return;
            this.steamNetworking.sendP2PMessage(msg.from, MessageTypes.NET_PONG, {
                sentAt: msg.data.sentAt,
            });
        };

        const pongHandler = (msg) => {
            if (this.steamNetworking?.isHost) return;
            if (!msg?.data?.sentAt) return;
            this.networkStats.rttMs = Date.now() - msg.data.sentAt;
            this._updateNetworkHud();
        };

        this.steamNetworking.on(MessageTypes.GAME_STATE_FULL, snapshotHandler);
        this.steamNetworking.on(MessageTypes.NET_PING, pingHandler);
        this.steamNetworking.on(MessageTypes.NET_PONG, pongHandler);

        this.cleanupHandlers.push(() => {
            this.steamNetworking.off(MessageTypes.GAME_STATE_FULL, snapshotHandler);
            this.steamNetworking.off(MessageTypes.NET_PING, pingHandler);
            this.steamNetworking.off(MessageTypes.NET_PONG, pongHandler);
        });

        if (!this.steamNetworking?.isHost && !this.pingInterval) {
            this.pingInterval = setInterval(() => {
                if (!this.steamNetworking?.hostSteamId) return;
                this.steamNetworking.sendP2PMessage(this.steamNetworking.hostSteamId, MessageTypes.NET_PING, {
                    sentAt: Date.now(),
                });
            }, 2000);
            this.cleanupHandlers.push(() => {
                clearInterval(this.pingInterval);
                this.pingInterval = null;
            });
        }

        // Register visual effect handlers for local player actions
        this._registerEffectHandlers();

        this.networkHandlersRegistered = true;
        console.log('[OnlineMultiplayer] Network handlers registered');
    }

    /**
     * Register visual effect handlers for the main player board
     * Effects only trigger for local player's actions
     */
    _registerEffectHandlers() {
        const localSteamId = this.steamNetworking?.steamId;
        const settings = this.deps.settingsManager?.get() || {};

        // Line clear effect handler
        this.lineClearEffectUnsub = onMultiplayerEvent(
            MULTIPLAYER_EVENTS.LINE_CLEAR,
            (detail) => {
                // Only trigger effects for local player
                if (detail.steamId !== localSteamId) return;
                if (!this.mainBoardScene) return;

                // Emit event for theme integration
                eventBus.emit(EVENTS.LINE_CLEAR, { lineCount: detail.rows?.length || 0 });

                // Trigger flash effect on cleared rows
                if (this.mainBoardScene.triggerLineClearFlash && detail.rows) {
                    this.mainBoardScene.triggerLineClearFlash(detail.rows);
                }

                // Play sound
                this.deps.soundManager?.sfxPlayer?.playLineClear?.();
            },
        );
        this.cleanupHandlers.push(this.lineClearEffectUnsub);

        // Line clear impact effect handler (camera shake + particles)
        this.lineClearImpactUnsub = onMultiplayerEvent(
            MULTIPLAYER_EVENTS.LINE_CLEAR_IMPACT,
            (detail) => {
                if (detail.steamId !== localSteamId) return;
                if (!this.mainBoardScene) return;

                const lineCount = detail.linesCleared || 0;
                const cascadeCount = detail.cascadeCount || 1;

                // Trigger impact effect (camera shake + particles)
                if (this.mainBoardScene.playLineClearImpact) {
                    this.mainBoardScene.playLineClearImpact(lineCount, cascadeCount);
                }

                // Trigger background pulse effect
                if (this.mainBoardScene.triggerBackgroundPulse) {
                    this.mainBoardScene.triggerBackgroundPulse(lineCount);
                }
            },
        );
        this.cleanupHandlers.push(this.lineClearImpactUnsub);

        // Combo effect handler
        this.comboEffectUnsub = onMultiplayerEvent(
            MULTIPLAYER_EVENTS.COMBO,
            (detail) => {
                if (detail.steamId !== localSteamId) return;
                if (!this.mainBoardScene) return;

                const comboCount = detail.comboCount || 0;

                // Emit event for theme integration
                eventBus.emit(EVENTS.COMBO, { comboCount });

                // Show combo popup
                if (settings.comboPopupEffect && this.mainBoardScene.showComboPopup) {
                    this.mainBoardScene.showComboPopup(comboCount);
                }

                // Show cascade wave indicator
                if (this.mainBoardScene.sharedEffects?.showCascadeWave) {
                    this.mainBoardScene.sharedEffects.showCascadeWave(comboCount);
                }
            },
        );
        this.cleanupHandlers.push(this.comboEffectUnsub);

        // Piece lock effect handler
        this.pieceLockEffectUnsub = onMultiplayerEvent(
            MULTIPLAYER_EVENTS.PIECE_LOCK,
            (detail) => {
                if (detail.steamId !== localSteamId) return;
                if (!this.mainBoardScene) return;

                const piece = detail.piece;

                // Emit event for theme integration
                eventBus.emit(EVENTS.PIECE_LOCK, { piece });

                // Create piece lock ripple effect
                if (piece && this.mainBoardScene.createPieceLockRipple) {
                    this.mainBoardScene.createPieceLockRipple(piece);
                }
            },
        );
        this.cleanupHandlers.push(this.pieceLockEffectUnsub);

        // Player topped out / death effect handler
        this.playerToppedOutUnsub = onMultiplayerEvent(
            MULTIPLAYER_EVENTS.PLAYER_TOPPED_OUT,
            (detail) => {
                // Show death animation for local player
                if (detail.isLocal || detail.steamId === localSteamId) {
                    console.log('[OnlineMultiplayer] Local player topped out - showing death animation');
                    this._showDeathAnimation(detail.killerName || null);
                }
            },
        );
        this.cleanupHandlers.push(this.playerToppedOutUnsub);

        this.garbageInsertedUnsub = onMultiplayerEvent(
            MULTIPLAYER_EVENTS.GARBAGE_INSERTED,
            (detail) => {
                if (!detail.isLocal) return;
                this._flashGarbageIndicator('flash', 500);
            },
        );
        this.cleanupHandlers.push(this.garbageInsertedUnsub);

        this.garbageCounteredUnsub = onMultiplayerEvent(
            MULTIPLAYER_EVENTS.GARBAGE_COUNTERED,
            (detail) => {
                if (!detail.isLocal) return;
                this._flashGarbageIndicator('countered', 600);
                if (typeof detail.remainingGarbage === 'number') {
                    this._updateGarbageMeter(detail.remainingGarbage);
                }
            },
        );
        this.cleanupHandlers.push(this.garbageCounteredUnsub);

        // Round restart - clear death overlay and reset board state
        this.roundRestartUnsub = onMultiplayerEvent(
            MULTIPLAYER_EVENTS.ROUND_RESTART,
            () => {
                console.log('[OnlineMultiplayer] Round restarting - clearing death state');
                this._clearDeathState();
            },
        );
        this.cleanupHandlers.push(this.roundRestartUnsub);

        console.log('[OnlineMultiplayer] Visual effect handlers registered');
    }

    /**
     * Handle state update from host
     */
    _handleStateUpdate(state) {
        if (!state || !state.players) return;

        // Update local board if we have state for this player
        const myState = state.players.find((p) => p.id === this.steamNetworking.steamId);
        if (myState && this.mainBoardScene) {
            // Sync board scene with network state
            if (this.mainBoardScene.syncFromNetworkState) {
                this.mainBoardScene.syncFromNetworkState(myState);
            }

            // Update garbage meter
            this._updateGarbageMeter(myState.pendingGarbage || 0);

            // Update stats display
            this._updateLocalStats(myState);
        }

        // Update opponent boards
        if (this.opponentWatchManager) {
            const opponents = state.players.filter((p) => p.id !== this.steamNetworking.steamId);
            this.opponentWatchManager.updateFromState(opponents);
        }

        // Update scoreboard
        const scoreboardPlayers = state.players.map((p) => ({
            id: p.id,
            name: p.name,
            frags: p.frags || 0,
            score: p.score || 0,
            lines: p.lines || 0,
            isAlive: p.isAlive !== false,
        }));
        if (this.scoreboard) {
            this.scoreboard.updatePlayers(scoreboardPlayers);
        }
        if (this.scoreboardOverlay) {
            this.scoreboardOverlay.updatePlayers(scoreboardPlayers);
        }
    }

    /**
     * Update UI for host (since we don't receive our own network packets)
     */
    _updateHostUI() {
        if (!this.ffaGameState) return;

        // Build a state object similar to what we'd receive from network
        const players = Array.from(this.ffaGameState.players.values()).map(p => ({
            steamId: p.steamId,
            name: p.name,
            frags: p.frags || 0,
            isAlive: p.isAlive,
            gameState: {
                score: p.score || 0,
                lines: p.lines || 0,
                boardGrid: p.grid, // Access grid directly from player object in FFA state
                nextPieces: p.nextPieces,
                currentPiece: p.currentPiece
            },
            garbageQueue: p.garbageQueue
        }));

        this._handleRenderFrame({ players });
    }

    /**
     * Handle render frames from the authoritative game state
     */
    _handleRenderFrame(detail) {
        if (!detail || !detail.players) return;

        const localId = this.steamNetworking?.steamId;
        const players = detail.players;
        const localPlayer = players.find((p) => p.steamId === localId);
        this._syncPlayerColors(players);

        if (localPlayer && this.mainBoardScene) {
            if (this.mainBoardScene.syncFromGameState) {
                this.mainBoardScene.syncFromGameState(localPlayer.gameState);
            } else {
                this.mainBoardScene.gameState = localPlayer.gameState;
            }

            // Update Next Queue
            const nextPieces = localPlayer.gameState?.nextPieces || [];
            const nextIds = nextPieces.join(',');
            if (nextIds !== this.lastNextPieceIds) {
                updateNextQueue(nextPieces, 'online-next-queue-container');
                this.lastNextPieceIds = nextIds;
            }

            // Update local stats + garbage
            const localState = {
                frags: localPlayer.frags || 0,
                deaths: 0,
                score: localPlayer.gameState?.score || 0,
                lines: localPlayer.gameState?.lines || 0,
            };
            this._updateLocalStats(localState);
            this._updateGarbageMeter(localPlayer.garbageQueue);
        }

        // Update opponent boards
        if (this.opponentWatchManager) {
            const playerStates = players.map((p) => ({
                id: p.steamId,
                name: p.name,
                frags: p.frags || 0,
                isAlive: p.isAlive !== false,
                grid: p.gameState?.boardGrid || p.gameState?.grid,
                currentPiece: p.gameState?.currentPiece,
                nextPieces: p.nextPieces || p.gameState?.nextPieces,
                color: p.color || this._getPlayerColor(p.steamId),
            }));

            // Apply local player's color to main board border
            if (localPlayer) {
                const mainBoard = document.getElementById('online-main-board');
                const localColor = localPlayer.color || this._getPlayerColor(localId);
                if (mainBoard && localColor) {
                    mainBoard.style.borderColor = localColor;
                }
            }

            const signature = playerStates.map((p) => p.id).join('|');
            if (signature && signature !== this.lastPlayerSignature) {
                this.opponentWatchManager.setPlayers(playerStates);
                this.lastPlayerSignature = signature;
            }

            this.opponentWatchManager.updateFromState(playerStates);
        }

        // Update scoreboard
        const scoreboardPlayers = players.map((p) => ({
            id: p.steamId,
            name: p.name,
            frags: p.frags || 0,
            score: p.gameState?.score || 0,
            lines: p.gameState?.lines || 0,
            isAlive: p.isAlive !== false,
        }));
        if (this.scoreboard) {
            this.scoreboard.updatePlayers(scoreboardPlayers);
        }
        if (this.scoreboardOverlay) {
            this.scoreboardOverlay.updatePlayers(scoreboardPlayers);
        }
    }

    /**
     * Handle player death event
     */
    _handlePlayerDeath(data) {
        const killerId = data.killer || data.killerId || null;
        const victimId = data.victimId || data.steamId || data.player || null;
        const killerName = data.killerName || this._getPlayerName(killerId) || (killerId ? String(killerId) : null);
        const victimName = data.victimName || data.playerName || this._getPlayerName(victimId) || (victimId ? String(victimId) : 'Unknown');
        const killerColor = this._getPlayerColor(killerId);
        const victimColor = this._getPlayerColor(victimId);

        if (this.killFeed) {
            this.killFeed.addKill({
                killer: killerName || 'Unknown',
                victim: victimName || 'Unknown',
                linesCleared: data.linesCleared,
                killerColor,
                victimColor,
                isSelfKill: !killerId || killerId === victimId,
            });
        }

        // If local player died, show death animation
        const localSteamId = this.steamNetworking?.steamId;
        if (victimId === localSteamId) {
            console.log('[OnlineMultiplayer] You died!');
            this._showDeathAnimation(killerName);
        }
    }

    /**
     * Show death animation on the main board
     * Includes camera flash, explosion overlay, and "ELIMINATED" text
     */
    _showDeathAnimation(killerName = null) {
        const boardContainer = document.getElementById('online-main-board');
        if (!boardContainer) return;

        // 1. Camera flash effect (if board scene available)
        if (this.mainBoardScene?.cameras?.main) {
            this.mainBoardScene.cameras.main.flash(400, 255, 255, 255, false);
        }

        boardContainer.classList.add('death-shake');
        setTimeout(() => boardContainer.classList.remove('death-shake'), 450);

        // 2. Create white flash overlay
        const flashOverlay = document.createElement('div');
        flashOverlay.className = 'death-flash-overlay';
        flashOverlay.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: white;
            opacity: 0;
            z-index: 50;
            pointer-events: none;
            transition: opacity 0.4s ease-in-out;
            border-radius: 8px;
        `;
        boardContainer.appendChild(flashOverlay);

        // Trigger flash animation
        requestAnimationFrame(() => {
            flashOverlay.style.opacity = '0.8';
            setTimeout(() => {
                flashOverlay.style.opacity = '0';
                setTimeout(() => flashOverlay.remove(), 400);
            }, 200);
        });

        // 3. Create death overlay with skull and text (after flash)
        setTimeout(() => {
            this._createDeathOverlay(boardContainer, killerName);
        }, 500);

        // 4. Add eliminated class to board for grayscale effect
        boardContainer.classList.add('eliminated');
    }

    /**
     * Create the death overlay with skull icon and "ELIMINATED" text
     */
    _createDeathOverlay(container, killerName = null) {
        const overlay = document.createElement('div');
        overlay.className = 'death-overlay';
        overlay.innerHTML = `
            <div class="death-content">
                <div class="death-skull">💀</div>
                <div class="death-text">ELIMINATED</div>
                <div class="death-killer"></div>
            </div>
        `;
        overlay.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.75);
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            z-index: 100;
            pointer-events: none;
            border-radius: 8px;
        `;

        // Style the content
        const content = overlay.querySelector('.death-content');
        content.style.cssText = `
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 10px;
        `;

        const skull = overlay.querySelector('.death-skull');
        skull.style.cssText = `
            font-size: 64px;
            opacity: 0;
            transform: scale(0.5) rotate(-45deg);
            transition: all 0.5s cubic-bezier(0.68, -0.55, 0.265, 1.55);
        `;

        const text = overlay.querySelector('.death-text');
        text.style.cssText = `
            font-size: 24px;
            font-weight: 700;
            color: #fc8181;
            text-shadow: 0 0 20px rgba(252, 129, 129, 0.5);
            opacity: 0;
            transform: scale(0.5) translateY(20px);
            transition: all 0.4s ease-out 0.2s;
        `;

        const killer = overlay.querySelector('.death-killer');
        if (killerName) {
            killer.textContent = `by ${killerName}`;
            killer.style.cssText = `
                font-size: 14px;
                color: #cbd5e0;
                opacity: 0;
                letter-spacing: 0.5px;
                transform: translateY(6px);
                transition: all 0.4s ease-out 0.3s;
            `;
        } else {
            killer.remove();
        }

        container.appendChild(overlay);

        // Animate in
        requestAnimationFrame(() => {
            skull.style.opacity = '1';
            skull.style.transform = 'scale(1) rotate(0deg)';
            text.style.opacity = '1';
            text.style.transform = 'scale(1) translateY(0)';
            if (killerName) {
                killer.style.opacity = '1';
                killer.style.transform = 'translateY(0)';
            }
        });
    }

    /**
     * Clear death state from the main board (for rematch/new game)
     */
    _clearDeathState() {
        const boardContainer = document.getElementById('online-main-board');
        if (!boardContainer) return;

        // Remove eliminated class
        boardContainer.classList.remove('eliminated');

        // Remove death overlay
        const deathOverlay = boardContainer.querySelector('.death-overlay');
        if (deathOverlay) {
            deathOverlay.remove();
        }

        // Remove flash overlay
        const flashOverlay = boardContainer.querySelector('.death-flash-overlay');
        if (flashOverlay) {
            flashOverlay.remove();
        }
    }

    /**
     * Update the garbage meter display
     */
    _updateGarbageMeter(queueOrAmount) {
        const bar = document.getElementById('online-garbage-bar');
        const fill = bar?.querySelector('.garbage-fill');
        const segments = bar?.querySelector('.garbage-segments');
        const valueEl = document.getElementById('online-garbage-value');

        const isQueue = queueOrAmount && typeof queueOrAmount.getTotalLines === 'function';
        const amount = isQueue ? queueOrAmount.getTotalLines() : Number(queueOrAmount || 0);

        if (fill) {
            const percentage = Math.min(100, (amount / 20) * 100);
            fill.style.height = `${percentage}%`;
        }

        if (segments) {
            this._renderGarbageSegments(segments, isQueue ? queueOrAmount : null, amount);
        }

        if (bar) {
            bar.classList.toggle('pending', amount > 0);
            bar.classList.toggle('warning', amount >= 8);
        }

        if (valueEl) {
            valueEl.textContent = amount;
        }
    }

    _updateNetworkHud() {
        if (!this.qosHud || !this.networkStats) return;
        this.qosHud.update(this.networkStats);
    }

    _renderGarbageSegments(container, garbageQueue, totalLines) {
        container.innerHTML = '';
        if (!garbageQueue || totalLines <= 0) return;

        const lineEntries = garbageQueue.entries.filter((entry) => entry.type === 'line');
        if (lineEntries.length === 0) return;

        const segments = [];
        lineEntries.forEach((entry) => {
            const color = entry.color || this._getPlayerColor(entry.attackerId) || '#808080';
            const last = segments[segments.length - 1];
            if (last && last.attackerId === entry.attackerId && last.color === color) {
                last.lines += 1;
            } else {
                segments.push({
                    attackerId: entry.attackerId,
                    color,
                    lines: 1,
                });
            }
        });

        const maxLines = 20;
        const scale = totalLines > maxLines ? maxLines / totalLines : 1;

        segments.forEach((segment) => {
            const height = (segment.lines * scale / maxLines) * 100;
            const div = document.createElement('div');
            div.className = 'garbage-segment';
            div.style.height = `${height}%`;
            div.style.background = segment.color;
            container.appendChild(div);
        });
    }

    _syncPlayerColors(players) {
        if (!players) return;
        players.forEach((player) => {
            if (player?.steamId && player.color) {
                this.playerColors.set(player.steamId, player.color);
            }
        });
    }

    _getPlayerColor(steamId) {
        if (!steamId) return null;
        if (this.playerColors.has(steamId)) {
            return this.playerColors.get(steamId);
        }
        const player = this.ffaGameState?.players?.get(steamId);
        return player?.color || null;
    }

    _getPlayerName(steamId) {
        if (!steamId) return null;
        const player = this.ffaGameState?.players?.get(steamId);
        return player?.name || null;
    }

    _flashGarbageIndicator(className, durationMs = 600) {
        const bar = document.getElementById('online-garbage-bar');
        if (!bar) return;

        if (this.garbageFlashTimers[className]) {
            clearTimeout(this.garbageFlashTimers[className]);
        }

        bar.classList.add(className);
        this.garbageFlashTimers[className] = setTimeout(() => {
            bar.classList.remove(className);
            delete this.garbageFlashTimers[className];
        }, durationMs);
    }

    /**
     * Update local player stats display
     */
    _updateLocalStats(state) {
        const updates = [
            ['online-frags', state.frags || 0],
            ['online-deaths', state.deaths || 0],
            ['online-score', state.score || 0],
            ['online-lines', state.lines || 0],
        ];

        updates.forEach(([id, value]) => {
            const el = document.getElementById(id);
            if (el) el.textContent = value;
        });
    }

    /**
     * Set up input handlers
     */
    _setupInputHandlers() {
        console.log('[OnlineMultiplayer] Input handlers set up');
    }

    _setupScoreboardOverlayHotkey() {
        if (this.scoreboardToggleHandler) return;

        this.scoreboardToggleHandler = (event) => {
            if (event.key !== 'Tab') return;
            if (this._isTextInputFocused()) return;

            event.preventDefault();
            this.scoreboardOverlay?.toggle();
        };

        window.addEventListener('keydown', this.scoreboardToggleHandler);
        this.cleanupHandlers.push(() => {
            window.removeEventListener('keydown', this.scoreboardToggleHandler);
            this.scoreboardToggleHandler = null;
        });
    }

    _isTextInputFocused() {
        const active = document.activeElement;
        if (!active) return false;
        const tag = active.tagName?.toLowerCase();
        return tag === 'input' || tag === 'textarea' || active.isContentEditable;
    }

    /**
     * Hook into global input functions so keyboard controls work
     */
    _hookInputs() {
        if (this.originalInputs.move) {
            return;
        }

        this.originalInputs = {
            move: window.move,
            rotate: window.rotate,
            hardDrop: window.hardDrop,
            softDrop: window.softDrop,
        };

        window.move = (dir) => {
            this.ffaGameState?.sendInput('move', { direction: dir });
        };

        window.rotate = (dir) => {
            this.ffaGameState?.sendInput('rotate', { direction: dir });
        };

        window.softDrop = () => {
            this.ffaGameState?.sendInput('drop', { type: 'soft' });
        };

        window.hardDrop = () => {
            this.ffaGameState?.sendInput('drop', { type: 'hard' });
        };
    }

    /**
     * Restore original global input hooks
     */
    _restoreInputs() {
        Object.keys(this.originalInputs).forEach((fnName) => {
            window[fnName] = this.originalInputs[fnName];
        });
        this.originalInputs = {};
    }

    /**
     * Send a chat message via network
     */
    _sendChatMessage(text) {
        if (!this.ffaGameState || !this.ffaGameState.network || !text) return;

        const payload = {
            playerName: this.ffaGameState.network.playerName,
            message: text,
            steamId: this.ffaGameState.localPlayerId,
            timestamp: Date.now(),
        };

        // Also add to local chat immediately
        if (this.chat) {
            this.chat.addMessage({
                author: 'You',
                text,
            });
        }

        // Broadcast to others (handled by ffa game state listeners)
        this.ffaGameState.network.broadcastToAll('game:chat', payload);
    }

    /**
     * Start the online game loop
     */
    _startOnlineGameLoop() {
        const SYNC_INTERVAL = 33; // ~30Hz
        let lastTime = performance.now();
        let timeSinceSync = 0;
        let frame = 0;

        const loop = (currentTime) => {
            if (!this.isInMatch) {
                console.log('[OnlineMultiplayer] Game loop stopped');
                return;
            }

            const delta = currentTime - lastTime;
            lastTime = currentTime;
            timeSinceSync += delta;
            frame++; // Increment frame counter

            // Host: Run game physics and broadcast state
            if (this.steamNetworking.isHost && this.ffaGameState) {
                // Update all player states
                this.ffaGameState.update(delta);

                if (this.mainBoardScene) {
                    const localPlayer = this.ffaGameState.players.get(this.steamNetworking.steamId);
                    if (localPlayer && this.mainBoardScene.gameState !== localPlayer.gameState) {
                        this.mainBoardScene.gameState = localPlayer.gameState;
                    }
                }

                // Update Next Queue
                if (this.ffaGameState.nextPieces) {
                    const nextIds = this.ffaGameState.nextPieces.join(',');
                    if (nextIds !== this.lastNextPieceIds) {
                        updateNextQueue(this.ffaGameState.nextPieces, 'online-next-queue-container');
                        this.lastNextPieceIds = nextIds;
                    }
                }

                // Render loop updates
                if (frame % 30 === 0) { // Broadcast state at 30Hz
                    this._broadcastGameState();
                    timeSinceSync = 0; // Reset timeSinceSync if still using it for other things, or remove if frame is primary
                }
            }

            // Continue loop
            this.gameLoopId = requestAnimationFrame(loop);
        };

        console.log('[OnlineMultiplayer] Starting game loop');
        this.gameLoopId = requestAnimationFrame(loop);
    }

    /**
     * Broadcast full game state to all peers (host only)
     */
    _broadcastGameState() {
        if (!this.steamNetworking.isHost || !this.ffaGameState) return;

        const state = this.ffaGameState.getFullState();
        this.steamNetworking.broadcastToAll('GAME_STATE_FULL', state);
    }

    /**
     * Clean up game rendering
     */
    _cleanupGameRendering() {
        // Stop game loop
        if (this.gameLoopId) {
            cancelAnimationFrame(this.gameLoopId);
            this.gameLoopId = null;
        }

        // Destroy Phaser game
        if (this.mainPhaserGame) {
            this.mainPhaserGame.destroy(true);
            this.mainPhaserGame = null;
            this.mainBoardScene = null;
        }

        // Destroy UI components
        if (this.opponentWatchManager) {
            this.opponentWatchManager.destroy();
            this.opponentWatchManager = null;
        }
        if (this.scoreboard) {
            this.scoreboard.destroy();
            this.scoreboard = null;
        }
        if (this.scoreboardOverlay) {
            this.scoreboardOverlay.destroy();
            this.scoreboardOverlay = null;
        }
        if (this.killFeed) {
            this.killFeed.destroy();
            this.killFeed = null;
        }
        if (this.chat) {
            this.chat.destroy();
            this.chat = null;
        }
        if (this.qosHud) {
            this.qosHud.destroy();
            this.qosHud = null;
        }

        this._restoreInputs();

        // Hide container
        const container = document.getElementById('online-multiplayer-container');
        if (container) {
            container.style.display = 'none';
        }

        Object.keys(this.garbageFlashTimers).forEach((key) => {
            clearTimeout(this.garbageFlashTimers[key]);
        });
        this.garbageFlashTimers = {};
        this.networkStats = null;
        this.snapshotStats = null;

        console.log('[OnlineMultiplayer] Game rendering cleaned up');
    }

    /**
     * Called when user clicks "Start Game" (or joins lobby)
     */
    async onStart() {
        console.log('[OnlineMultiplayer] Starting online game...');

        // For online multiplayer, the game starts through the lobby flow
        // If onStart is called before lobby selection, just wait for user interaction
        if (!this.lobbyBrowser) {
            console.log('[OnlineMultiplayer] Waiting for lobby browser initialization...');
            return;
        }

        // Now actually start if we have a lobby
        await super.onStart();

        console.log('[OnlineMultiplayer] Use lobby browser to create/join matches');
    }

    /**
     * Called when game is paused
     */
    onPause() {
        super.onPause();

        console.log('[OnlineMultiplayer] Pause requested (may not be allowed in competitive)');

        // In competitive online multiplayer, pausing is typically not allowed
        // Players can leave, but the match continues for others
    }

    /**
     * Called when game is resumed
     */
    onResume() {
        super.onResume();

        console.log('[OnlineMultiplayer] Resume requested');
    }

    /**
     * Called when game ends
     */
    async onStop() {
        await super.onStop();

        console.log('[OnlineMultiplayer] Stopping online game...');

        if (this.isInMatch) {
            // Clean up match rendering
            this._cleanupGameRendering();
            this.isInMatch = false;

            // Match results are handled via MatchResultsModal listener
        }

        if (this.matchResultsModal) {
            this.matchResultsModal.hide();
        }

        console.log('[OnlineMultiplayer] ✅ Game stopped');
    }

    /**
     * Called when mode is deselected
     */
    async onDeactivate() {
        await super.onDeactivate();

        console.log('[OnlineMultiplayer] Deactivating...');

        // Clean up game rendering first
        if (this.isInMatch) {
            this._cleanupGameRendering();
            this.isInMatch = false;
        }

        // Leave current lobby
        if (this.currentLobbyId && this.steamNetworking) {
            console.log('[OnlineMultiplayer] Leaving lobby...');
            this.steamNetworking.leaveLobby();
            this.currentLobbyId = null;
        }

        // Hide and cleanup lobby UI
        if (this.lobbyBrowser) {
            this.lobbyBrowser.hide();
        }

        if (this.lobbyWaitingRoom) {
            this.lobbyWaitingRoom.hide();
        }

        // Cleanup game state
        if (this.ffaGameState) {
            this.ffaGameState.cleanup();
            this.ffaGameState = null;
        }

        // Clean up event listeners
        this._cleanupEventListeners(this.cleanupHandlers);
        this.cleanupHandlers = [];
        this.lastSyncTime = 0;
        this.lastNextPieceIds = '';
        this.matchStartedUnsub = null;
        this.matchResultsUnsub = null;
        this.renderFrameUnsub = null;
        this.networkHandlersRegistered = false;
        this.lastPlayerSignature = '';

        if (this.matchResultsModal) {
            this.matchResultsModal.destroy();
            this.matchResultsModal = null;
        }

        console.log('[OnlineMultiplayer] ✅ Deactivated');
    }

    /**
     * Get current state
     */
    getState() {
        return {
            ...super.getState(),
            isConnected: this.steamNetworking?.initialized || false,
            lobbyId: this.currentLobbyId,
            playerCount: this.ffaGameState?.players?.size || 0,
            isInMatch: this.isInMatch,
        };
    }
}
