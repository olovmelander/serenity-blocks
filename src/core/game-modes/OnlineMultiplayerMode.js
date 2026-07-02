import Phaser from 'phaser';
import { BaseGameMode } from './BaseGameMode.js';
import { BoardJuice } from '../../rendering/phaser/board-juice.js';
import {
    GAME_MODES, COLS, ROWS, BLOCK_SIZE,
} from '../constants.js';
import { SteamNetworking } from '../steam/steam-networking.js';
import steamService from '../steam/steam-service.js';
import { STEAM_LEADERBOARDS } from '../steam/steam-config.js';
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
import { SnapshotInterpolator } from '../network/snapshot-interpolation.js';
import { performanceMonitor } from '../../utils/performance-monitor.js';

function readOnlineNetFlag(name, defaultOn) {
    if (typeof window === 'undefined') return defaultOn;
    const search = (window.location && window.location.search) || '';
    if (new RegExp(`[?&]${name}=1\\b`).test(search)) return true;
    if (new RegExp(`[?&]${name}=0\\b`).test(search)) return false;
    try {
        const ls = window.localStorage && window.localStorage.getItem(`serenity.${name}`);
        if (ls === '1') return true;
        if (ls === '0') return false;
    } catch (e) { /* localStorage unavailable; keep default */ }
    return defaultOn;
}

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
        this.matchPreparingUnsub = null;
        this.matchStartedUnsub = null;
        this.matchResultsUnsub = null;
        this.renderFrameUnsub = null;
        this.playerListRichPresenceUnsub = null;
        this._uiSetupComplete = false;
        this.networkHandlersRegistered = false;
        this.lastPlayerSignature = '';
        this.originalInputs = {};
        this.playerColors = new Map();
        this.garbageFlashTimers = {};
        this.scoreboardToggleHandler = null;
        this.networkStats = null;
        this.snapshotStats = null;
        this.pingInterval = null;
        this.roundNumber = 1;
        // Spectator / spectate-after-death UI state (B5).
        this.isSpectator = false;
        this._deathShown = false;
        this._deadSpectating = false;
        this._preDeathMaxVisible = null;
        this.roundStingerElement = null;
        this.roundStingerTimer = null;
        this.roundStingerRunId = 0;

        // Cleanup handlers
        this.cleanupHandlers = [];

        // Snapshot Interpolation. The default path preserves the verified 90ms delay.
        // adaptiveInterp=1 maps snapshots onto the host sim timeline and raises only
        // cosmetic opponent-view delay, smoothing jitter without changing authority.
        this._adaptiveInterpEnabled = readOnlineNetFlag('adaptiveInterp', false);
        this.snapshotInterpolator = new SnapshotInterpolator({
            interpolationDelay: this._adaptiveInterpEnabled ? 120 : 90,
            adaptive: this._adaptiveInterpEnabled,
            minInterpolationDelay: this._adaptiveInterpEnabled ? 100 : 90,
            maxInterpolationDelay: 180,
            simTickMs: 1000 / 60,
            snapshotIntervalMs: 1000 / 30,
            maxBufferSize: this._adaptiveInterpEnabled ? 24 : 10,
        });

        // === PERFORMANCE OPTIMIZATIONS ===
        // RAF throttling for RENDER_FRAME events (batch multiple events per frame)
        this._renderFrameScheduled = false;
        this._pendingRenderDetail = null;
        // Cache local player reference (changes rarely, avoids find() every frame)
        this._cachedLocalId = null;
        this._cachedLocalPlayerIndex = -1;
        // Pre-allocated opponent slots (reused every frame, saves ~300 allocations/sec).
        // Sized 8 (the max roster): a PLAYER sees ≤7 opponents (one of 8 is local), but a
        // SPECTATOR has no local board and watches the FULL roster of up to 8 — so the
        // _processRenderFrame opponent loop must be able to feed all 8 boards a fresh piece.
        this._opponentSlots = new Array(8).fill(null).map(() => ({
            id: null,
            steamId: null,
            name: null,
            color: null,
            isAlive: true,
            frags: 0,
            garbageQueue: null,
            garbagePending: 0,
            grid: null,
            currentPiece: null,
            nextPieces: null,
        }));
        this._activeOpponentCount = 0;

        // SPECTATOR render driver: a watch-only spectator never joins ffaGameState.players
        // and never runs the unified game loop, so it never emits RENDER_FRAME and
        // _processRenderFrame (the only path that feeds a live/interpolated currentPiece into
        // the watch boards) never runs — leaving the opponents' falling pieces frozen. This
        // RAF loop reproduces that path for a spectator, driven by the snapshot stream it
        // already receives. Null unless the local client is a spectator and a match is live.
        this._spectatorRenderId = null;
        this._latestSnapshotPlayers = null;
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
            (lobbyId, options) => this.handleJoinLobby(lobbyId, options),
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
    async handleJoinLobby(lobbyId, options = {}) {
        try {
            const asSpectator = !!options.asSpectator;
            this.isSpectator = asSpectator;
            console.log(`[OnlineMultiplayer] Joining lobby: ${lobbyId}${asSpectator ? ' (SPECTATOR)' : ''}`);

            // Leave any existing lobby state before joining a new one
            if (this.currentLobbyId && this.currentLobbyId !== lobbyId && this.steamNetworking) {
                this.steamNetworking.leaveLobby();
                this.currentLobbyId = null;
                this._clearLobbyRichPresence();
            }

            if (this.ffaGameState) {
                this.ffaGameState.cleanup();
                this.ffaGameState = null;
            }

            if (this.lobbyBrowser) {
                this.lobbyBrowser.hide();
            }

            // Join the lobby via Steam
            await this.steamNetworking.joinLobby(lobbyId);

            // Create FFA game state as peer (or spectator — no local board/input).
            this.ffaGameState = new FFAGameStateP2P(
                this.steamNetworking,
                this.steamNetworking.steamId,
                { asSpectator },
            );
            if (!asSpectator) {
                this._configureLocalInputHooks(this.ffaGameState);
            }

            // Announce join to host (carries asSpectator so the host won't roster a spectator)
            this.ffaGameState.announceJoin();

            // Joiners (and spectators) can be kicked by the host at any point (lobby or
            // match), so subscribe once for the lifetime of this mode. The host never gets
            // this (it doesn't kick itself).
            if (!this._kickedUnsub) {
                this._kickedUnsub = onMultiplayerEvent(
                    MULTIPLAYER_EVENTS.KICKED,
                    (detail) => this._handleKicked(detail),
                );
                this.cleanupHandlers.push(this._kickedUnsub);
            }

            this.currentLobbyId = lobbyId;

            // Fetch lobby name
            let lobbyName = 'FFA Match';
            try {
                const name = await this.steamNetworking.getLobbyData(lobbyId, 'game_name');
                if (name) lobbyName = name;
            } catch (err) {
                console.warn('[OnlineMultiplayer] Failed to fetch lobby name:', err);
            }

            // Update game state with lobby info
            if (this.ffaGameState) {
                this.ffaGameState.lobbyId = lobbyId;
                this.ffaGameState.lobbyName = lobbyName;
            }

            this._setLobbyRichPresence();

            // Show waiting room
            this.showWaitingRoom();

            console.log('[OnlineMultiplayer] ✅ Joined lobby successfully');
        } catch (error) {
            console.error('[OnlineMultiplayer] Failed to join lobby:', error);
            this._clearLobbyRichPresence();
            try {
                if (this.lobbyBrowser) {
                    await this.showLobbyBrowser();
                }
            } catch (showErr) {
                console.warn('[OnlineMultiplayer] Failed to restore lobby browser:', showErr.message);
            }
            alert(`Failed to join lobby: ${error.message}`);
        }
    }

    /**
     * Join a lobby via Steam invite (bypasses lobby browser flow)
     */
    async joinLobbyFromInvite(lobbyId) {
        if (!lobbyId) return;
        await this.handleJoinLobby(lobbyId);
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
            this._configureLocalInputHooks(this.ffaGameState);

            // Set match configuration
            this.ffaGameState.matchConfig = {
                endCondition: config.endCondition,
                endConditionValue: config.endConditionValue,
                startLevel: 1,
                levelProgression: false,
                allowHandicap: true,
                boringRules: config.boringRules || false,
                garbageCancellation: config.garbageCancellation || 'full',
                attackStyle: config.attackStyle || 'standard',
                attackRules: config.attackRules || null,
                hotPotato: config.hotPotato || false,
                potatoDurationMs: config.potatoDurationMs || 12000,
                potatoPenaltyLines: config.potatoPenaltyLines || 6,
                maxPlayers: config.maxPlayers,
            };

            this.currentLobbyId = lobbyId;

            // Update game state with lobby info
            if (this.ffaGameState) {
                this.ffaGameState.lobbyId = lobbyId;
                this.ffaGameState.lobbyName = config.gameName || 'FFA Match';
            }

            this._setLobbyRichPresence();

            // Hide the lobby browser (mirrors handleJoinLobby) — without this the HOST's
            // browser stays mounted behind the waiting room and then shows THROUGH over the
            // match once the waiting room hides ("host sees menus; joiner doesn't").
            if (this.lobbyBrowser) {
                this.lobbyBrowser.hide();
            }

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

        // Dispatch Rich Presence update for lobby status
        const playerCount = this.ffaGameState?.players?.size || 1;
        const maxPlayers = this.ffaGameState?.maxPlayers || 8;
        window.dispatchEvent(new CustomEvent('game:lobbyStatus', {
            detail: {
                playerCount,
                maxPlayers,
                lobbyId: this.ffaGameState.lobbyId,
                lobbyName: this.ffaGameState.lobbyName
            }
        }));

        // Update Steam Rich Presence group size when lobby members change
        if (!this.playerListRichPresenceUnsub) {
            this.playerListRichPresenceUnsub = onMultiplayerEvent(
                MULTIPLAYER_EVENTS.PLAYER_LIST_CHANGED,
                () => this._setLobbyRichPresence(),
            );
            this.cleanupHandlers.push(this.playerListRichPresenceUnsub);
        }

        // Listen for MATCH_PREPARING - set up UI before countdown starts
        if (!this.matchPreparingUnsub) {
            this.matchPreparingUnsub = onMultiplayerEvent(
                MULTIPLAYER_EVENTS.MATCH_PREPARING,
                () => this._setupMatchUI(),
            );
            this.cleanupHandlers.push(this.matchPreparingUnsub);
        }

        // Listen for MATCH_STARTED - game actually starts after countdown
        if (!this.matchStartedUnsub) {
            this.matchStartedUnsub = onMultiplayerEvent(
                MULTIPLAYER_EVENTS.MATCH_STARTED,
                () => this._activateMatch(),
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

        this._clearLobbyRichPresence();

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
    /**
     * Set up match UI - called BEFORE countdown starts
     * Shows boards, chat, scoreboard behind the countdown overlay
     */
    async _setupMatchUI() {
        console.log('[OnlineMultiplayer] Setting up match UI...');
        this.lastNextPieceIds = '';
        if (this.matchResultsModal) {
            this.matchResultsModal.hide();
        }

        if (this._uiSetupComplete) {
            console.log('[OnlineMultiplayer] UI already set up, skipping');
            return;
        }

        // Hide waiting room
        if (this.lobbyWaitingRoom) {
            this.lobbyWaitingRoom.hide();
        }

        // Clear any death overlays from previous match
        this._clearDeathState();
        this._clearRoundStartEffects();
        this.roundNumber = 1;

        // Hide other containers
        this._hideOtherContainers();

        // Show online multiplayer container
        const container = document.getElementById('online-multiplayer-container');
        if (container) {
            container.style.display = 'grid';
        }

        // Create main board (Phaser) for local player — a SPECTATOR has no board, so show
        // a placeholder in the main-board slot instead of a Phaser game with no gameState.
        if (this.ffaGameState?.isSpectator) {
            this._showSpectatorMainBoardPlaceholder();
        } else {
            await this._createMainBoard();
        }

        // Create opponent watch manager (spectators watch the FULL roster here)
        this._createOpponentBoards();

        // Initialize right panel (scoreboard, kill feed, chat)
        this._initializeRightPanel();

        // Register network handlers for state sync
        this._registerNetworkHandlers();

        // Set up input handlers (but game won't respond until isInMatch = true)
        this._setupInputHandlers();
        this._setupScoreboardOverlayHotkey();

        this._uiSetupComplete = true;
        console.log('[OnlineMultiplayer] ✅ Match UI ready (waiting for countdown)');
    }

    /**
     * Activate match - called AFTER countdown completes
     * Enables gameplay inputs and marks match as active
     */
    _activateMatch() {
        console.log('[OnlineMultiplayer] Activating match (countdown complete)...');

        if (this.isInMatch) {
            console.log('[OnlineMultiplayer] Match already active, skipping');
            return;
        }

        // Mark match as active - enables input handling
        this.isInMatch = true;
        this._suspendThemeForMatch();
        this._registerNetworkHandlers();
        // A spectator never controls a board, so don't wire the gameplay input globals
        // (window.move/rotate/… would read a non-existent local player). FFAGameStateP2P
        // .sendInput also hard-returns for spectators as the authoritative backstop.
        if (!this.ffaGameState?.isSpectator) {
            this._hookInputs();
        }
        this._setupVisibilityHandler();

        // Reset UI setup flag for next match
        this._uiSetupComplete = false;

        // Dispatch Rich Presence update for match start
        const playerCount = this.ffaGameState?.players?.size || 1;
        window.dispatchEvent(new CustomEvent('game:matchPosition', {
            detail: { position: 1, playerCount }
        }));

        // Drop-in mid-match: we joined as a dead/waiting roster member, so show the full-
        // roster watch view immediately (reusing the spectate-after-death view). The next
        // round restart revives us (shared seed) and _clearDeathState → _exitDeadSpectate
        // returns us to normal play.
        const localPlayer = this.ffaGameState?.getLocalPlayer?.();
        if (!this.ffaGameState?.isSpectator && localPlayer && localPlayer.isAlive === false) {
            console.log('[OnlineMultiplayer] Joined mid-match as waiting — spectating until next round');
            this._enterDeadSpectate();
        }

        // A watch-only spectator has no game loop to emit RENDER_FRAME, so drive the watch
        // boards from the snapshot stream itself (otherwise the falling pieces freeze). Only
        // a true spectator needs this — a dead/eliminated PLAYER still runs the loop.
        if (this.ffaGameState?.isSpectator) {
            this._startSpectatorRenderLoop();
        }

        console.log('[OnlineMultiplayer] ✅ Match started! Game is now active.');
    }

    /**
     * Legacy method - kept for compatibility
     * @deprecated Use _setupMatchUI() and _activateMatch() instead
     */
    async handleMatchStart() {
        await this._setupMatchUI();
        this._activateMatch();
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

        const AUTO_RETURN_MS = 45000;
        if (this.matchResultsModal) {
            this.matchResultsModal.show(detail, {
                isHost: this.steamNetworking?.isHost,
                localPlayerId: this.steamNetworking?.steamId,
                gameState: this.ffaGameState, // Pass gameState for chat history access
                autoReturnMs: AUTO_RETURN_MS, // all clients show a "returning in N s" countdown
            });
        }

        // A4d host-idle auto-advance: if the HOST never picks Play Again / Return, send
        // everyone back to the lobby after the deadline so an idle/rage-quit host can't
        // freeze the results screen for all players. Auto-RETURN (not auto-rematch) — we
        // don't force unwilling players into another game. Host-authoritative: the host's
        // timer fires _handleReturnToLobby, which broadcasts RETURN_TO_LOBBY so peers follow.
        this._clearResultsAutoAdvance();
        if (this.steamNetworking?.isHost) {
            this._resultsAutoAdvanceTimer = setTimeout(() => {
                this._resultsAutoAdvanceTimer = null;
                console.log('[OnlineMultiplayer] Results auto-advance — host idle, returning everyone to lobby');
                this._handleReturnToLobby();
            }, AUTO_RETURN_MS);
        }

        this._syncFfaSteamStats(detail).catch((err) => {
            console.warn('[OnlineMultiplayer] Steam stats sync failed:', err.message);
        });
    }

    /** Cancel the results-screen host-idle auto-advance timer (host only sets it). */
    _clearResultsAutoAdvance() {
        if (this._resultsAutoAdvanceTimer) {
            clearTimeout(this._resultsAutoAdvanceTimer);
            this._resultsAutoAdvanceTimer = null;
        }
    }

    /** Create the network-stats object if missing (it's nulled on match cleanup). */
    _ensureNetworkStats() {
        if (!this.networkStats) {
            this.networkStats = {
                rttMs: this.steamNetworking?.isHost ? 0 : null,
                lossPct: 0,
                snapshotRate: null,
                route: this.steamNetworking?.mockMode ? 'Mock' : 'Steam',
            };
        }
        return this.networkStats;
    }

    /**
     * Sync FFA Steam stats and leaderboards (best-effort, non-blocking)
     * @private
     */
    async _syncFfaSteamStats(detail) {
        if (!detail?.finalStats || !this.steamNetworking?.steamId) {
            return;
        }

        const localSteamId = this.steamNetworking.steamId;
        const localStats = detail.finalStats.find((entry) => `${entry.steamId}` === `${localSteamId}`);
        if (!localStats) {
            return;
        }

        const kills = localStats.frags || 0;
        const isWinner = localStats.placement === 1;
        const durationSeconds = Math.max(1, Math.round((detail.duration || 0) / 1000));
        const durationMinutes = Math.max(1, Math.round(durationSeconds / 60));

        const matchesBefore = steamService.getCachedStat('ffa_matches', 0);
        const winsBefore = steamService.getCachedStat('ffa_wins', 0);
        const killsBefore = steamService.getCachedStat('ffa_kills', 0);

        await Promise.all([
            steamService.incrementStat('ffa_matches', 1),
            steamService.incrementStat('ffa_kills', kills),
            steamService.incrementStat('total_lines_cleared', localStats.lines || 0),
            steamService.incrementStat('playtime_minutes', durationMinutes),
            isWinner ? steamService.incrementStat('ffa_wins', 1) : Promise.resolve(true),
        ]);

        const matches = steamService.getCachedStat('ffa_matches', matchesBefore + 1);
        const wins = steamService.getCachedStat('ffa_wins', winsBefore + (isWinner ? 1 : 0));
        const totalKills = steamService.getCachedStat('ffa_kills', killsBefore + kills);
        const winRateScore = matches > 0 ? Math.round((wins / matches) * 10000) : 0;

        const scoreDetails = {
            score: localStats.score || 0,
            duration: durationSeconds,
            linesCleared: localStats.lines || 0,
            highestLevel: localStats.level || 0,
            kills,
            wins,
            matches,
            placement: localStats.placement,
            mode: 'ffa',
            version: '1.0.0',
        };

        await Promise.all([
            steamService.uploadScore(STEAM_LEADERBOARDS.FFA_TOTAL_KILLS, totalKills, {
                ...scoreDetails,
                extraValue: totalKills,
            }),
            steamService.uploadScore(STEAM_LEADERBOARDS.FFA_WIN_RATE, winRateScore, {
                ...scoreDetails,
                extraValue: totalKills,
            }),
        ]);
    }

    /**
     * Play again (host only)
     */
    _handlePlayAgain() {
        if (!this.ffaGameState || !this.steamNetworking?.isHost) {
            return;
        }

        this._clearResultsAutoAdvance(); // host chose rematch — cancel the idle timer

        if (this.matchResultsModal) {
            this.matchResultsModal.hide();
        }

        this.ffaGameState.restartFullGame();
    }

    /**
     * Return to lobby waiting room. When the HOST invokes this (button or auto-advance),
     * it broadcasts RETURN_TO_LOBBY so peers leave the results screen too — otherwise a
     * host returning to the lobby would strand peers on their results modal forever.
     */
    _handleReturnToLobby() {
        this._clearResultsAutoAdvance();
        if (this.steamNetworking?.isHost) {
            this.steamNetworking.broadcastToAll?.(MessageTypes.RETURN_TO_LOBBY, {});
        }
        this._returnToLobbyLocal();
    }

    /** The local half of returning to the lobby (no broadcast) — also run on a peer that
     * received RETURN_TO_LOBBY from the host. */
    _returnToLobbyLocal() {
        this._clearResultsAutoAdvance();
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
        this._clearResultsAutoAdvance();
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
     * We were kicked by the host — tear down and return to the start menu with a notice.
     * Reuses the exit-to-menu teardown; the alert tells the player why.
     */
    async _handleKicked() {
        console.warn('[OnlineMultiplayer] Kicked by host — leaving match');
        try { await this._handleExitToMenu(); } catch (e) { /* best-effort teardown */ }
        // Non-blocking notice (a blocking alert() would freeze the page mid-teardown).
        try {
            window.dispatchEvent(new CustomEvent('serenity:toast', {
                detail: { message: 'You were removed from the match by the host.', type: 'warning' },
            }));
        } catch (e) { /* no-op */ }
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
    /**
     * Spectators have no board — fill the main-board slot with a clear "watching" panel
     * instead of an empty/broken container or a Phaser game with no gameState.
     */
    _showSpectatorMainBoardPlaceholder() {
        const container = document.getElementById('online-main-board');
        if (!container) return;
        this.mainBoardScene = null;
        this.mainPhaserGame = null;
        // A spectator has no local board → flag the layout so local-only chrome (the
        // own-stats bar, which would just show zeros) is hidden via CSS.
        document.getElementById('online-multiplayer-container')?.classList.add('spectating');
        // A spectator has no board of its own — turn the main board into a "spotlight" that
        // shows ONE selected player at full size. The OpponentWatchManager drives the canvas
        // (setSpotlight, wired in _createOpponentBoards); clicking a mini-board picks who.
        container.innerHTML = `
            <div class="spectator-spotlight">
                <div class="spectator-spotlight-header">
                    <span class="spectator-spotlight-eye">👁</span>
                    <span class="spectator-spotlight-name">SPECTATING</span>
                    <span class="spectator-spotlight-frags"></span>
                </div>
                <div class="spectator-spotlight-stage">
                    <div class="spectator-spotlight-board-row">
                        <div class="garbage-indicator spectator-spotlight-garbage">
                            <div class="garbage-fill"></div>
                            <div class="garbage-segments"></div>
                            <div class="garbage-glow"></div>
                        </div>
                        <canvas class="spectator-spotlight-canvas"></canvas>
                    </div>
                </div>
                <div class="spectator-spotlight-hint">Click a board on the left to spotlight a player</div>
            </div>
        `;
    }

    async _createMainBoard() {
        const container = document.getElementById('online-main-board');
        if (!container) {
            throw new Error('Main board container not found');
        }
        // CRITICAL: dispose any EXISTING board before creating a new one. _setupMatchUI can run
        // again (it resets _uiSetupComplete in _activateMatch) on a new round / rematch / host
        // migration — and without this each call mounts ANOTHER position:relative <canvas>.
        // Stacked canvases push the live board out of the overflow:hidden frame, so the board
        // renders content but looks EMPTY ("no tetrominos") from round 2 on, and each orphaned
        // Phaser game leaks a WebGL context. Guarantee exactly one board canvas.
        if (this.mainPhaserGame) {
            try { this.mainPhaserGame.destroy(true); } catch (e) { /* best-effort */ }
            this.mainPhaserGame = null;
            this.mainBoardScene = null;
        }
        // Belt-and-suspenders: clear any leftover/orphaned canvases a prior game didn't remove.
        container.innerHTML = '';
        // Playing locally (not spectating) → ensure the spectator layout flag is cleared.
        document.getElementById('online-multiplayer-container')?.classList.remove('spectating');

        // Import BoardScene dynamically using factory function
        const { createBoardScene } = await import('../../rendering/phaser/board-scene.js');
        const BoardScene = createBoardScene(Phaser);

        // Use fixed internal resolution for consistent rendering
        // This matches how LocalMultiplayerMode handles it
        const FIXED_BLOCK_SIZE = 40;
        const internalWidth = COLS * FIXED_BLOCK_SIZE; // 10 * 40 = 400
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
        // A spectator has no board of its own, so show the WHOLE roster (not just 4
        // opponents-besides-me). Its localPlayerId isn't in the roster, so setPlayers'
        // local-filter is a no-op. setMaxVisible also widens the CSS grid (full-roster
        // class) so >4 boards aren't clipped off-screen.
        if (this.ffaGameState?.isSpectator) {
            this.opponentWatchManager.setMaxVisible(8);

            // Wire the main-board spotlight: the watch manager renders the selected player
            // full-size onto the spotlight canvas and reports name/frags changes here.
            const spotlightCanvas = document.querySelector('#online-main-board .spectator-spotlight-canvas');
            if (spotlightCanvas) {
                const nameEl = document.querySelector('#online-main-board .spectator-spotlight-name');
                const fragsEl = document.querySelector('#online-main-board .spectator-spotlight-frags');
                const eyeEl = document.querySelector('#online-main-board .spectator-spotlight-eye');
                // The player card frames the whole center column. Host/peer tint it to their OWN
                // colour (_processRenderFrame ~1841); a spectator has no local player so it kept the
                // default BLUE — the other half of the "purple+blue border" the user reported. Tint
                // it to the SPOTLIGHTED player's colour to match the host/peer look.
                const playerCardEl = document.getElementById('online-player-card');
                // Pending-garbage meter for the spotlight — mirrors the main board's vertical
                // bar so the watched board reads like a real player board (the watcher missed it).
                const spotlightGarbage = document.querySelector('#online-main-board .spectator-spotlight-garbage');
                this.opponentWatchManager.setSpotlight(spotlightCanvas, {
                    garbage: spotlightGarbage ? {
                        meter: spotlightGarbage,
                        fill: spotlightGarbage.querySelector('.garbage-fill'),
                        segments: spotlightGarbage.querySelector('.garbage-segments'),
                    } : null,
                    onChange: (player) => {
                        if (nameEl) nameEl.textContent = player?.name || 'SPECTATING';
                        if (fragsEl) fragsEl.textContent = player ? `⚔️ ${player.frags || 0}` : '';
                        // Tint the spotlight CANVAS to the SELECTED player's colour so the watched
                        // board's frame reflects who you're watching. The purple #online-board-border
                        // overlay is hidden under .spectating, so the canvas border+glow is the single
                        // clean frame around the board (matching the host/peer board).
                        const color = player?.color || (player?.id && this._getPlayerColor(player.id)) || '#5eead4';
                        if (nameEl) nameEl.style.color = color;
                        if (eyeEl) eyeEl.style.color = color;
                        spotlightCanvas.style.borderColor = color;
                        spotlightCanvas.style.boxShadow = `0 0 22px ${color}55, inset 0 0 14px ${color}22`;
                        // Match host/peer card framing (see _processRenderFrame): coloured border +
                        // glow + faint gradient — so the whole center frame reflects the watched player.
                        if (playerCardEl) {
                            playerCardEl.style.borderColor = `${color}cc`;
                            playerCardEl.style.borderWidth = '3px';
                            playerCardEl.style.boxShadow = `0 0 30px ${color}66, inset 0 0 20px ${color}1a`;
                            playerCardEl.style.background = `linear-gradient(145deg, rgba(0, 0, 0, 0.5), ${color}0d)`;
                        }
                    },
                });
            }
        }

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
            autoWatchBtn.onclick = () => this.opponentWatchManager.toggleAutoWatch();
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

            // Restore chat history from game state
            if (this.ffaGameState && this.ffaGameState.chatHistory) {
                this.ffaGameState.chatHistory.forEach(msg => {
                    const isSystem = !msg.playerName;
                    this.chat.addMessage({
                        author: isSystem ? 'System' : msg.playerName,
                        text: isSystem ? (msg.text || msg.message) : msg.message,
                        isSystem: isSystem,
                        color: msg.color || this._getPlayerColor(msg.steamId),
                    });
                });
            }
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
            const color = msg.data.color || this._getPlayerColor(msg.data.steamId);
            this.chat.addMessage({
                author: msg.data.playerName || msg.data.author,
                text: msg.data.message || msg.data.text,
                color,
            });
        };

        // A4d: the host returned everyone to the lobby (manual or idle auto-advance).
        // Peers follow without re-broadcasting (host is the sole initiator).
        const returnToLobbyHandler = () => {
            if (this.steamNetworking?.isHost) return;
            console.log('[OnlineMultiplayer] Host returned to lobby — following');
            this._returnToLobbyLocal();
        };

        this.steamNetworking.on(MessageTypes.GAME_PLAYER_FRAG, fragHandler);
        this.steamNetworking.on(MessageTypes.GAME_PLAYER_DIED, deathHandler);
        this.steamNetworking.on(MessageTypes.GAME_GARBAGE_SENT, garbageHandler);
        this.steamNetworking.on('game:chat', chatHandler);
        this.steamNetworking.on(MessageTypes.RETURN_TO_LOBBY, returnToLobbyHandler);

        this.cleanupHandlers.push(() => {
            this.steamNetworking.off(MessageTypes.GAME_PLAYER_FRAG, fragHandler);
            this.steamNetworking.off(MessageTypes.GAME_PLAYER_DIED, deathHandler);
            this.steamNetworking.off(MessageTypes.GAME_GARBAGE_SENT, garbageHandler);
            this.steamNetworking.off('game:chat', chatHandler);
            this.steamNetworking.off(MessageTypes.RETURN_TO_LOBBY, returnToLobbyHandler);
        });

        this._ensureNetworkStats();
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

            // networkStats is nulled by _cleanupGameRendering on return-to-lobby/exit; a
            // late snapshot/pong that arrives after that would otherwise crash on a null
            // write. Re-ensure it (also covers stats after a lobby→rematch round-trip).
            this._ensureNetworkStats();
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

            // Critical fix: Actually process the state update!
            this._handleStateUpdate(msg.data);
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
            this._ensureNetworkStats(); // null-safe after return-to-lobby cleanup
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
                eventBus.emit(EVENTS.LINE_CLEAR, {
                    lineCount: detail.rows?.length || 0,
                    clearedRows: detail.rows || [],
                });

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

        // Phase 1+2: OPPONENT clear handler — staged flash (+ combo) on the OPPONENT's
        // mini-board. Separate from LINE_CLEAR above (which the local board owns), so the
        // two never double-fire. The watcher draws on its own overlay canvas; it never
        // touches the opponent grid, so it cannot fight the snapshot interpolator.
        this.opponentClearUnsub = onMultiplayerEvent(
            MULTIPLAYER_EVENTS.OPPONENT_CLEAR,
            (detail) => {
                if (!this.opponentWatchManager || detail.steamId === localSteamId) return;
                const lineCount = detail.linesCleared || (detail.rows?.length || 0);
                const cascadeCount = detail.cascadeCount || 1;
                const color = lineCount >= 4 ? '#f59e0b' : lineCount === 3 ? '#fbbf24' : '#ffffff';
                this.opponentWatchManager.triggerOpponentClear?.(detail.steamId, {
                    rows: detail.rows || [],
                    lineCount,
                    color,
                });
                if (cascadeCount >= 2) {
                    this.opponentWatchManager.triggerOpponentCombo?.(detail.steamId, cascadeCount, color);
                }
            },
        );
        this.cleanupHandlers.push(this.opponentClearUnsub);

        // Piece lock effect handler
        this.pieceLockEffectUnsub = onMultiplayerEvent(
            MULTIPLAYER_EVENTS.PIECE_LOCK,
            (detail) => {
                if (detail.steamId !== localSteamId) {
                    const color = this._getPlayerColor(detail.steamId);
                    this.opponentWatchManager?.triggerOpponentPieceLock?.(detail.steamId, color);
                    return;
                }
                if (!this.mainBoardScene) return;

                const { piece } = detail;

                // Emit event for theme integration
                eventBus.emit(EVENTS.PIECE_LOCK, { piece });

                // Create piece lock ripple effect
                if (piece && this.mainBoardScene.createPieceLockRipple) {
                    this.mainBoardScene.createPieceLockRipple(piece);
                }
            },
        );
        this.cleanupHandlers.push(this.pieceLockEffectUnsub);

        // Hard drop effect handler
        this.hardDropEffectUnsub = onMultiplayerEvent(
            'game:hard_drop',
            (detail) => {
                if (detail.steamId !== localSteamId) {
                    const color = this._getPlayerColor(detail.steamId);
                    this.opponentWatchManager?.triggerOpponentHardDrop?.(detail.steamId, detail.dropData, color);
                    return;
                }
                if (!this.mainBoardScene) return;

                const { dropData } = detail;

                this.deps.soundManager?.sfxPlayer.playDrop();

                if (dropData && this.mainBoardScene.sharedEffects?.playHardDropEffect) {
                    this.mainBoardScene.sharedEffects.playHardDropEffect(dropData);
                }
            },
        );
        this.cleanupHandlers.push(this.hardDropEffectUnsub);

        // Player topped out / death effect handler
        this.playerToppedOutUnsub = onMultiplayerEvent(
            MULTIPLAYER_EVENTS.PLAYER_TOPPED_OUT,
            (detail) => {
                // Record completion in kill feed
                this._handlePlayerDeath(detail);

                // Show death animation for local player
                if (detail.isLocal || detail.steamId === localSteamId) {
                    console.log('[OnlineMultiplayer] Local player topped out - showing death animation');
                    this._showDeathAnimation(detail.killerName || null);
                } else if (detail.steamId) {
                    this.opponentWatchManager?.setOpponentDeadState?.(detail.steamId, true);
                }
            },
        );
        this.cleanupHandlers.push(this.playerToppedOutUnsub);

        this.garbageInsertedUnsub = onMultiplayerEvent(
            MULTIPLAYER_EVENTS.GARBAGE_INSERTED,
            (detail) => {
                if (!detail.isLocal) {
                    const targetId = detail.steamId ?? detail.playerId;
                    if (targetId) {
                        this.opponentWatchManager?.triggerOpponentGarbage?.(targetId, '#f87171');
                    }
                    return;
                }
                this._flashGarbageIndicator('flash', 500);
            },
        );
        this.cleanupHandlers.push(this.garbageInsertedUnsub);

        this.perfectClearUnsub = onMultiplayerEvent(
            MULTIPLAYER_EVENTS.PERFECT_CLEAR,
            (detail) => {
                if (detail.steamId !== localSteamId) {
                    this.opponentWatchManager?.triggerOpponentPerfectClear?.(detail.steamId, detail.depth, '#ffffff');
                    return;
                }

                eventBus.emit(EVENTS.PERFECT_CLEAR, {
                    depth: detail.depth,
                    perfectClearBonus: detail.perfectClearBonus,
                    source: 'online',
                });
                this.deps.soundManager?.sfxPlayer?.playPerfectClear?.();
                this.mainBoardScene?.sharedEffects?.playPerfectClear?.(detail.depth);
            },
        );
        this.cleanupHandlers.push(this.perfectClearUnsub);

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

        // Local echo of the host's OWN outgoing attacks → Battle Log. The host never
        // receives its own network broadcast, so without this its attacks are
        // invisible in the log. Only the host runs routeAttack (which emits this),
        // and peers log from the network message instead — so it fires once per node.
        this.garbageSentLocalUnsub = onMultiplayerEvent(
            MULTIPLAYER_EVENTS.GARBAGE_SENT,
            (detail) => {
                if (!this.killFeed) return;
                const targetLabel = detail.targetCount === 1
                    ? '1 player'
                    : `${detail.targetCount || 0} players`;
                this.killFeed.addGarbageSent({
                    sender: detail.fromName,
                    target: targetLabel,
                    lines: detail.totalLines || 0,
                    senderColor: this._getPlayerColor(detail.from),
                });
            },
        );
        this.cleanupHandlers.push(this.garbageSentLocalUnsub);

        // Round restart - clear death overlay and reset board state
        this.roundRestartUnsub = onMultiplayerEvent(
            MULTIPLAYER_EVENTS.ROUND_RESTART,
            () => {
                console.log('[OnlineMultiplayer] Round restarting - clearing death state');
                this._clearDeathState();
                this.opponentWatchManager?.clearOpponentEffectStates?.();
                this.roundNumber += 1;
                // Battle Log is transactional/append-only across the WHOLE match: keep
                // prior rounds' rows (host AND peers see the full history) and just drop in
                // a divider so the new round is visually delimited instead of wiping the log.
                this.killFeed?.addRoundMarker(this.roundNumber);
                this._playRoundStartStinger();
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
        const receivedAt = Date.now();

        const normalizedPlayers = state.players.map((player) => ({
            ...player,
            id: player.id ?? player.steamId,
        }));

        // SPECTATOR render driver reads the freshest snapshot each animation frame (a
        // spectator has no game loop / RENDER_FRAME, so this is its only data source). The
        // interpolator below smooths it; this is just the latest authoritative roster+state.
        this._latestSnapshotPlayers = normalizedPlayers;

        // Feed snapshot to interpolator
        this.snapshotInterpolator.addSnapshot({
            ...state,
            players: normalizedPlayers,
            receivedAt,
            timestamp: receivedAt, // Ensure we use arrival time if server time is drifted
        }, { receivedAt });
        this._updateInterpolationNetworkStats(normalizedPlayers);

        // Update local board if we have state for this player
        const myState = normalizedPlayers.find((p) => p.id === this.steamNetworking.steamId);
        if (myState && this.mainBoardScene) {
            // Sync board scene with network state
            if (this.mainBoardScene.syncFromNetworkState) {
                this.mainBoardScene.syncFromNetworkState(myState);
            }

            // Update garbage meter
            this._updateGarbageMeter(myState.pendingGarbage || 0);

            // Update stats display
            this._updateLocalStats(myState);

            // Tear down the ELIMINATED overlay the moment we're revived (round reset).
            // Strict === true: a missing/undefined isAlive must never clear it early.
            this._reconcileDeathOverlay(myState.isAlive === true);

            // Drop-in mid-match joiner observed as dead/waiting with NO elimination animation
            // (a fresh joiner doesn't get _showDeathAnimation): enter the full-roster watch
            // view from the snapshot — robust to the join-time race where isAlive flips to
            // false only after _activateMatch ran. Idempotent (eliminated players enter via
            // _showDeathAnimation); revived/exit is handled by _clearDeathState on round restart.
            if (!this.ffaGameState?.isSpectator && myState.isAlive === false
                && !this._deadSpectating && !this._deathShown) {
                this._enterDeadSpectate();
            }
        }

        // Update opponent boards
        if (this.opponentWatchManager) {
            // This is the fallback update for low-rate updates (30Hz)
            // Real smoothness comes from _handleRenderFrame using interpolation

            // We can skip this update if we are running the render loop,
            // but keeping it ensures we don't miss updates if render loop pauses.
            // However, to prevent jitter/fighting, we might relying purely on _handleRenderFrame?
            // Actually, let's let _handleRenderFrame handle visual updates.
            // But we need to update stats/metadata here?

            // Metadata + discrete grid only. We DROP currentPiece here so this 30Hz
            // raw write can't stomp the 60fps interpolated piece that
            // _processRenderFrame owns (the verified cause of opponent "snap every
            // ~33ms"). The smooth, interpolated piece flows through the render loop.
            const opponents = normalizedPlayers
                .filter((p) => p.id !== this.steamNetworking.steamId)
                .map(({ currentPiece, ...meta }) => meta);
            this.opponentWatchManager.updateFromState(opponents);
        }

        // Update scoreboard — throttled to ~4Hz, sharing the SAME guard as the RAF
        // render path (_processRenderFrame) so the two feeds don't contend and re-render
        // the scoreboard ~30Hz (the peer snapshot rate). A 250ms scoreboard lag is
        // imperceptible; it removes the churn that made tied rows flicker/jump.
        const sbNow = Date.now();
        if (!this._lastScoreboardUpdate || sbNow - this._lastScoreboardUpdate > 250) {
            this._lastScoreboardUpdate = sbNow;
            const scoreboardPlayers = normalizedPlayers.map((p) => ({
                id: p.id,
                name: p.name,
                frags: p.frags || 0,
                score: p.score || 0,
                lines: p.lines || 0,
                isAlive: p.isAlive !== false,
                awaitingSpawn: p.awaitingSpawn === true,
                color: p.color || this._getPlayerColor(p.id) || p.steamId && this._getPlayerColor(p.steamId),
            }));
            if (this.scoreboard) {
                this.scoreboard.updatePlayers(scoreboardPlayers);
            }
            if (this.scoreboardOverlay) {
                this.scoreboardOverlay.updatePlayers(scoreboardPlayers);
            }
        }
    }

    /**
     * Update UI for host (since we don't receive our own network packets)
     */
    _updateHostUI() {
        if (!this.ffaGameState) return;

        // Build a state object similar to what we'd receive from network
        const players = Array.from(this.ffaGameState.players.values()).map((p) => ({
            steamId: p.steamId,
            name: p.name,
            frags: p.frags || 0,
            isAlive: p.isAlive,
            awaitingSpawn: p.awaitingSpawn === true,
            gameState: {
                score: p.score || 0,
                lines: p.lines || 0,
                boardGrid: p.grid, // Access grid directly from player object in FFA state
                nextPieces: p.nextPieces,
                currentPiece: p.currentPiece,
            },
            garbageQueue: p.garbageQueue,
        }));

        this._handleRenderFrame({ players });
    }

    /**
     * Start the spectator render driver (watch-only spectators only).
     *
     * A spectator runs no game loop, so it never emits RENDER_FRAME and _processRenderFrame
     * never runs for it — the one path that feeds a live/interpolated currentPiece into the
     * watch boards. Without it the opponents' falling pieces freeze (the grid still updates
     * at 30Hz via _handleStateUpdate, but currentPiece is stripped there to avoid fighting
     * the interpolated piece on host/peer). This RAF loop rebuilds a render-frame from the
     * latest snapshot (in the gameState-nested shape _processRenderFrame expects) and calls
     * _processRenderFrame directly, so the spectator gets the SAME interpolation, roster
     * setPlayers, garbage meters and scoreboard updates as a player — just RAF-driven.
     *
     * Idempotent (guards on _spectatorRenderId, like OpponentWatchManager.startAnimationLoop).
     */
    _startSpectatorRenderLoop() {
        if (this._spectatorRenderId) return;
        const tick = () => {
            // Re-arm first so a throw in _processRenderFrame can't kill the loop permanently.
            this._spectatorRenderId = requestAnimationFrame(tick);
            const snap = this._latestSnapshotPlayers;
            if (!snap || !snap.length) return; // no snapshot yet → nothing to render

            // Flat snapshot player → the nested gameState shape _processRenderFrame reads.
            // _processRenderFrame applies the snapshotInterpolator (already fed by
            // _handleStateUpdate) on top, and its signature check drives setPlayers so
            // mid-watch roster joins/leaves are reflected automatically.
            const players = new Array(snap.length);
            for (let i = 0; i < snap.length; i++) {
                const p = snap[i];
                players[i] = {
                    steamId: p.id ?? p.steamId,
                    name: p.name,
                    color: p.color,
                    isAlive: p.isAlive,
                    awaitingSpawn: p.awaitingSpawn === true,
                    isDisconnected: p.isDisconnected,
                    frags: p.frags || 0,
                    nextPieces: p.nextPieces,
                    // Snapshots carry garbagePending (count) + garbageEntries (for coloured
                    // segments), not a live GarbageQueue. Shim the interface the watch meter
                    // reads so the spectator's garbage meters work like a player's.
                    garbageQueue: {
                        getTotalLines: () => p.garbagePending || 0,
                        entries: p.garbageEntries || [],
                    },
                    gameState: {
                        score: p.score || 0,
                        lines: p.lines || 0,
                        boardGrid: p.grid,
                        currentPiece: p.currentPiece,
                        nextPieces: p.nextPieces,
                        blindTimers: p.blindTimers,
                    },
                };
            }
            this._processRenderFrame({ players, playerCount: players.length });
        };
        this._spectatorRenderId = requestAnimationFrame(tick);
        console.log('[OnlineMultiplayer] 👁 Spectator render loop started');
    }

    /** Stop the spectator render driver (no-op if not running). */
    _stopSpectatorRenderLoop() {
        if (this._spectatorRenderId) {
            cancelAnimationFrame(this._spectatorRenderId);
            this._spectatorRenderId = null;
        }
    }

    /**
     * Handle render frames from the authoritative game state
     * PERF: Uses RAF throttling to batch multiple RENDER_FRAME events per frame
     */
    _handleRenderFrame(detail) {
        if (!detail || !detail.players) return;

        // PERF: RAF throttling - batch multiple RENDER_FRAME events per frame
        // Store latest data and schedule processing for next animation frame
        this._pendingRenderDetail = detail;

        if (!this._renderFrameScheduled) {
            this._renderFrameScheduled = true;
            requestAnimationFrame(() => {
                this._renderFrameScheduled = false;
                if (this._pendingRenderDetail) {
                    this._processRenderFrame(this._pendingRenderDetail);
                    this._pendingRenderDetail = null;
                }
            });
        }
    }

    /**
     * Process render frame (actual work, called once per RAF)
     */
    _processRenderFrame(detail) {
        if (!detail || !detail.players) return;

        const localId = this.steamNetworking?.steamId;
        const { players } = detail;
        // PERF: Use playerCount from pre-allocated payload if available
        const playerCount = detail.playerCount ?? players.length;

        // PERF: Cache local player lookup - only search when localId changes
        let localPlayer = null;
        if (this._cachedLocalId !== localId) {
            this._cachedLocalId = localId;
            this._cachedLocalPlayerIndex = -1;
            for (let i = 0; i < playerCount; i++) {
                if (players[i]?.steamId === localId) {
                    this._cachedLocalPlayerIndex = i;
                    break;
                }
            }
        }
        if (this._cachedLocalPlayerIndex >= 0 && this._cachedLocalPlayerIndex < playerCount) {
            localPlayer = players[this._cachedLocalPlayerIndex];
        }

        this._syncPlayerColors(players, playerCount);

        if (localPlayer && this.mainBoardScene) {
            if (this.mainBoardScene.syncFromGameState) {
                this.mainBoardScene.syncFromGameState(localPlayer.gameState);
            } else {
                this.mainBoardScene.gameState = localPlayer.gameState;
            }

            // Update Next Queue (only if changed)
            const nextPieces = localPlayer.gameState?.nextPieces || [];
            const nextIds = nextPieces.slice(0, 5).join(','); // PERF: Only check first 5
            if (nextIds !== this.lastNextPieceIds) {
                updateNextQueue(nextPieces, 'online-next-queue-container');
                this.lastNextPieceIds = nextIds;
            }

            // Update local stats + garbage
            this._updateLocalStats({
                frags: localPlayer.frags || 0,
                deaths: localPlayer.deaths || 0,
                score: localPlayer.gameState?.score || 0,
                lines: localPlayer.gameState?.lines || 0,
            });
            this._updateGarbageMeter(localPlayer.garbageQueue);

            // Safe revival check (=== true): never clears on a missing isAlive field.
            this._reconcileDeathOverlay(localPlayer.isAlive === true);
        }

        // Update Opponent Boards with INTERPOLATION
        // PERF: Reuse pre-allocated opponent slots instead of filter().map()
        if (this.opponentWatchManager && players) {
            const renderTime = Date.now();
            let opponentIdx = 0;

            for (let i = 0; i < playerCount && opponentIdx < this._opponentSlots.length; i++) {
                const p = players[i];
                if (!p || p.steamId === localId) continue;

                const slot = this._opponentSlots[opponentIdx];
                const gs = p.gameState || {};

                // Assign to pre-allocated slot (no new object creation)
                slot.id = slot.steamId = p.steamId;
                slot.name = p.name;
                slot.color = p.color;
                slot.isAlive = p.isAlive;
                slot.awaitingSpawn = p.awaitingSpawn === true;
                slot.frags = p.frags;
                slot.garbageQueue = p.garbageQueue;
                slot.garbagePending = p.garbageQueue?.getTotalLines?.() || 0;
                slot.grid = gs.boardGrid || gs.grid;
                slot.currentPiece = gs.currentPiece;
                slot.nextPieces = gs.nextPieces;
                slot.blindTimers = gs.blindTimers;

                // Apply interpolation if available
                const interpolated = this.snapshotInterpolator.getInterpolatedState(p.steamId, renderTime);
                if (interpolated) {
                    slot.currentPiece = interpolated.currentPiece || slot.currentPiece;
                    slot.grid = interpolated.grid || interpolated.gameState?.boardGrid || slot.grid;
                }

                opponentIdx++;
            }

            // PERF: Pass slice of pre-allocated array with only active opponents
            this._activeOpponentCount = opponentIdx;
            if (opponentIdx > 0) {
                this.opponentWatchManager.updateFromState(this._opponentSlots.slice(0, opponentIdx));
            }
        }

        // Apply local player's color to the player-card using the same approach as local multiplayer
        if (localPlayer) {
            const playerCard = document.getElementById('online-player-card');
            const localColor = localPlayer.color || this._getPlayerColor(localId);

            // PERF: these ~20 style writes only change when the local color or the window
            // size changes — skip the whole block on the per-frame path otherwise (it was
            // re-applying identical inline styles every RENDER_FRAME).
            const cardStyleKey = localColor && playerCard
                ? `${localColor}|${window.innerWidth}x${window.innerHeight}`
                : null;
            if (cardStyleKey && cardStyleKey === this._lastCardStyleKey) {
                // unchanged — nothing to re-apply
            } else if (localColor && playerCard) {
                this._lastCardStyleKey = cardStyleKey;
                // Set CSS custom properties (same as local multiplayer)
                playerCard.style.setProperty('--player-primary', localColor);
                playerCard.style.setProperty('--player-primary-light', localColor);
                playerCard.style.setProperty('--player-glow', `${localColor}80`);

                // Size the HERO board to FILL the center column (Quadra: the focused board is
                // the star), instead of the old fixed 280px cap that left the wide 1fr center
                // column mostly empty. Drive both dims off a single per-block cell so the 10x20
                // board stays 1:2 and fully visible. Measure .main-board-panel (now fills its
                // grid track); fall back to a window-derived estimate if it isn't laid out yet.
                // NOTE: --board-width is set on #online-player-card (scoped) — local/single-player
                // use their own cards, so this does not affect them.
                const mainPanel = document.querySelector('.main-board-panel');
                // clamp() mirrors --online-opponents-width / --online-info-width in multiplayer-ui.css.
                const clampPx = (min, vwFrac, max) => Math.min(max, Math.max(min, window.innerWidth * vwFrac));
                const estColW = window.innerWidth - 32 - 20 - clampPx(300, 0.24, 460) - clampPx(300, 0.20, 440);
                const colW = (mainPanel && mainPanel.clientWidth > 200) ? mainPanel.clientWidth : estColW;
                const colH = (mainPanel && mainPanel.clientHeight > 200) ? mainPanel.clientHeight : (window.innerHeight - 32);
                // Chrome reserved around the board: garbage meter + card padding (~60px horiz);
                // NEXT-piece row + stats bar + card padding + breathing room (~350px vert). The
                // extra reserve (was 280) keeps the stats bar visible AND leaves a clear margin
                // above/below the hero board so it doesn't crowd the top/bottom screen edges.
                // Max cell 72 keeps it from getting oversized on tall displays.
                const cell = Math.max(16, Math.min(72, Math.floor(Math.min((colW - 60) / 10, (colH - 350) / 20))));
                const boardWidth = 10 * cell;
                const boardHeight = 20 * cell;
                playerCard.style.setProperty('--board-width', `${boardWidth}px`);
                playerCard.style.setProperty('--board-height', `${boardHeight}px`);
                playerCard.style.setProperty('--next-piece-size', '38px');
                playerCard.style.setProperty('--next-piece-highlight-size', '44px');
                playerCard.style.setProperty('--next-piece-gap', `${boardWidth * 0.025}px`);

                // Apply card border, shadow, and background (same as local multiplayer data-player styles)
                playerCard.style.borderColor = `${localColor}cc`;
                playerCard.style.borderWidth = '3px';
                playerCard.style.boxShadow = `0 0 30px ${localColor}66, inset 0 0 20px ${localColor}1a`;
                playerCard.style.background = `linear-gradient(145deg, rgba(0, 0, 0, 0.5), ${localColor}0d)`;

                // Darken the board explicitly
                const boardSection = playerCard.querySelector('.player-board-section');
                if (boardSection) {
                    boardSection.style.background = 'rgba(10, 8, 24, 0.8)';
                }

                // Apply color to phaser board container border
                const boardContainer = playerCard.querySelector('.phaser-board-container');
                if (boardContainer) {
                    boardContainer.style.borderTop = 'none';
                    boardContainer.style.borderRight = `2px solid ${localColor}`;
                    boardContainer.style.borderBottom = `2px solid ${localColor}`;
                    boardContainer.style.borderLeft = `2px solid ${localColor}`;
                    boardContainer.style.borderRadius = '0 0 12px 12px';
                    boardContainer.style.boxShadow = `0 0 20px ${localColor}40`;
                }

                // Apply color to board border overlay
                const borderOverlay = document.getElementById('online-board-border');
                if (borderOverlay) {
                    borderOverlay.style.borderTop = 'none';
                    borderOverlay.style.borderRightColor = localColor;
                    borderOverlay.style.borderBottomColor = localColor;
                    borderOverlay.style.borderLeftColor = localColor;
                    borderOverlay.style.borderRadius = '0 0 12px 12px';
                    borderOverlay.style.boxShadow = `0 0 15px ${localColor}60, inset 0 0 10px ${localColor}40`;
                }
            }
        }

        // PERF: Build signature without creating new array
        let signature = '';
        for (let i = 0; i < playerCount; i++) {
            if (players[i]?.steamId) {
                signature += (i > 0 ? '|' : '') + players[i].steamId;
            }
        }

        if (signature && signature !== this.lastPlayerSignature) {
            // Set players on opponentWatchManager, ensuring it gets all players (including local for metadata)
            // Note: setPlayers is only called when players join/leave, so map() here is acceptable
            const watchPlayers = [];
            for (let i = 0; i < playerCount; i++) {
                const p = players[i];
                if (!p) continue;
                watchPlayers.push({
                    id: p.steamId,
                    name: p.name,
                    frags: p.frags || 0,
                    isAlive: p.isAlive !== false,
                    awaitingSpawn: p.awaitingSpawn === true,
                    isDisconnected: p.isDisconnected,
                    grid: p.gameState?.boardGrid || p.gameState?.grid,
                    currentPiece: p.gameState?.currentPiece,
                    nextPieces: p.nextPieces || p.gameState?.nextPieces,
                    garbageQueue: p.garbageQueue,
                    garbagePending: p.garbageQueue?.getTotalLines?.() || 0,
                    color: p.color || this._getPlayerColor(p.steamId),
                });
            }
            this.opponentWatchManager.setPlayers(watchPlayers);
            this.lastPlayerSignature = signature;
        }

        // PERF: Throttle scoreboard updates (4 times/sec is plenty)
        const now = Date.now();
        if (!this._lastScoreboardUpdate || now - this._lastScoreboardUpdate > 250) {
            this._lastScoreboardUpdate = now;
            const scoreboardPlayers = [];
            for (let i = 0; i < playerCount; i++) {
                const p = players[i];
                if (!p) continue;
                scoreboardPlayers.push({
                    id: p.steamId,
                    name: p.name,
                    frags: p.frags || 0,
                    score: p.gameState?.score || 0,
                    lines: p.gameState?.lines || 0,
                    isAlive: p.isAlive !== false,
                    awaitingSpawn: p.awaitingSpawn === true,
                    color: p.color || this._getPlayerColor(p.steamId),
                });
            }
            if (this.scoreboard) {
                this.scoreboard.updatePlayers(scoreboardPlayers);
            }
            if (this.scoreboardOverlay) {
                this.scoreboardOverlay.updatePlayers(scoreboardPlayers);
            }
        }
    }

    /**
     * Handle player death event
     */
    _handlePlayerDeath(data) {
        const killerId = data.killer || data.killerId || null;
        const victimId = data.victimId || data.steamId || data.player || null;
        const isSelfKill = data.isSelfKill ?? (!killerId || killerId === victimId);
        const resolvedKillerName = data.killerName
            || this._getPlayerName(killerId)
            || (killerId ? String(killerId) : null);
        const killerName = isSelfKill ? null : resolvedKillerName;
        const victimName = data.victimName
            || data.playerName
            || this._getPlayerName(victimId)
            || (victimId ? String(victimId) : 'Unknown');
        const killerColor = this._getPlayerColor(killerId);
        const victimColor = this._getPlayerColor(victimId);

        if (this.killFeed) {
            this.killFeed.addKill({
                killer: killerName,
                victim: victimName || 'Unknown',
                linesCleared: data.linesCleared,
                killerColor,
                victimColor,
                isSelfKill,
                // Stable, node-independent identity: a victim dies once per round, and
                // roundNumber is in lock-step on host + peer. So the host's local
                // PLAYER_TOPPED_OUT and the peer's network game:player:died produce the
                // SAME eventId → both nodes show one identical row (no clock-skewed dedup).
                eventId: victimId ? `death:${victimId}:${this.roundNumber}` : undefined,
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

        // Idempotent: a single death can be signalled by both PLAYER_TOPPED_OUT and
        // _handlePlayerDeath — only animate once per death until the next clear.
        if (this._deathShown) return;
        this._deathShown = true;

        // B5: eliminated → keep watching. Expand to the full-roster watch view so a dead
        // player can follow everyone still playing (not just the 4-up beside their now-dead
        // board) until the round resolves. Reverted on revive in _clearDeathState.
        this._enterDeadSpectate();

        // 1. Camera flash effect (if board scene available)
        if (this.mainBoardScene?.cameras?.main) {
            this.mainBoardScene.cameras.main.flash(400, 255, 255, 255, false);
        }

        boardContainer.classList.add('death-shake');
        if (this._deathShakeTimer) clearTimeout(this._deathShakeTimer);
        this._deathShakeTimer = setTimeout(() => boardContainer.classList.remove('death-shake'), 450);

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

        // 3. Create death overlay with skull and text (after flash).
        // Track the handle so _clearDeathState can cancel a still-pending overlay
        // (a round-ending death emits ROUND_RESTART BEFORE this fires).
        if (this._deathOverlayTimer) clearTimeout(this._deathOverlayTimer);
        this._deathOverlayTimer = setTimeout(() => {
            this._deathOverlayTimer = null;
            // If we were revived/cleared while the timer was pending, don't show it.
            if (!this._deathShown) return;
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
        // Cancel any still-pending death animation so it can't be born after the
        // round already reset (the orphaned-timeout bug that stuck "ELIMINATED").
        if (this._deathOverlayTimer) {
            clearTimeout(this._deathOverlayTimer);
            this._deathOverlayTimer = null;
        }
        if (this._deathShakeTimer) {
            clearTimeout(this._deathShakeTimer);
            this._deathShakeTimer = null;
        }
        this._deathShown = false;

        const boardContainer = document.getElementById('online-main-board');
        if (!boardContainer) return;

        boardContainer.classList.remove('eliminated');
        boardContainer.classList.remove('death-shake');
        boardContainer.querySelector('.death-overlay')?.remove();
        boardContainer.querySelector('.death-flash-overlay')?.remove();

        // B5: revived (round restart) → back to the normal watch-while-playing view.
        this._exitDeadSpectate();
    }

    /**
     * B5 — spectate-after-death: when the LOCAL player is eliminated but the match
     * continues, expand the opponent watch grid to the full roster so they can watch
     * everyone still alive. (A pure spectator is already full-roster, so skip.) Reverted
     * by _exitDeadSpectate on revive.
     */
    _enterDeadSpectate() {
        if (this._deadSpectating || this.ffaGameState?.isSpectator) return;
        if (!this.opponentWatchManager) return;
        this._deadSpectating = true;
        this._preDeathMaxVisible = this.opponentWatchManager.maxVisible;
        // setMaxVisible widens the CSS grid (full-roster class) so all alive players fit.
        this.opponentWatchManager.setMaxVisible(8);
        document.getElementById('online-multiplayer-container')?.classList.add('dead-spectating');
        // A DROP-IN joiner (waiting, no elimination animation) gets a clear "you'll spawn
        // next round" banner over its empty board. An ELIMINATED player (_deathShown) already
        // has the "ELIMINATED" overlay, so don't add the join banner for them.
        if (!this._deathShown) {
            this._showDropInWaitingBanner();
        }
    }

    _exitDeadSpectate() {
        if (!this._deadSpectating) return;
        this._deadSpectating = false;
        this.opponentWatchManager?.setMaxVisible(this._preDeathMaxVisible || 4);
        document.getElementById('online-multiplayer-container')?.classList.remove('dead-spectating');
        this._hideDropInWaitingBanner();
    }

    /** Banner over the (empty) main board telling a mid-match drop-in joiner they're queued. */
    _showDropInWaitingBanner() {
        const container = document.getElementById('online-main-board');
        if (!container || container.querySelector('.dropin-waiting-banner')) return;
        if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
        const banner = document.createElement('div');
        banner.className = 'dropin-waiting-banner';
        banner.innerHTML = '<span class="dropin-waiting-icon">⏳</span> Joined mid-match — you\'ll spawn next round';
        // Fit + WRAP within the board (was white-space:nowrap, which overflowed the narrow board
        // and got clipped at both ends by overflow:hidden).
        banner.style.cssText = 'position:absolute;top:8px;left:50%;transform:translateX(-50%);z-index:40;max-width:calc(100% - 16px);box-sizing:border-box;padding:8px 12px;border-radius:10px;background:rgba(8,10,23,0.88);border:1px solid rgba(94,234,212,0.45);color:#5eead4;font-weight:700;font-size:12px;letter-spacing:0.2px;line-height:1.3;text-align:center;white-space:normal;overflow-wrap:break-word;pointer-events:none;box-shadow:0 0 16px rgba(94,234,212,0.2);';
        container.appendChild(banner);
    }

    _hideDropInWaitingBanner() {
        document.getElementById('online-main-board')?.querySelector('.dropin-waiting-banner')?.remove();
    }

    /**
     * Reconcile the death overlay against authoritative liveness. Driven from
     * state updates so the overlay is torn down the instant the local player is
     * revived (round restart), independent of event ordering/timeouts.
     */
    _reconcileDeathOverlay(isAlive) {
        if (isAlive === true && this._deathShown) {
            this._clearDeathState();
        }
    }

    _ensureRoundStartStinger() {
        const container = document.getElementById('online-multiplayer-container');
        if (!container) return null;

        if (this.roundStingerElement && this.roundStingerElement.isConnected) {
            return this.roundStingerElement;
        }

        const stinger = document.createElement('div');
        stinger.className = 'online-round-stinger';
        stinger.setAttribute('aria-hidden', 'true');
        stinger.innerHTML = `
            <div class="online-round-stinger__line"></div>
            <div class="online-round-stinger__content">
                <div class="online-round-stinger__label">ROUND START</div>
                <div class="online-round-stinger__round">ROUND 1</div>
                <div class="online-round-stinger__subtitle">FIRST TO 10 FRAGS</div>
            </div>
            <div class="online-round-stinger__line"></div>
        `;
        container.appendChild(stinger);
        this.roundStingerElement = stinger;
        return stinger;
    }

    _playRoundStartStinger() {
        const container = document.getElementById('online-multiplayer-container');
        const mainBoard = document.getElementById('online-main-board');
        const stinger = this._ensureRoundStartStinger();
        if (!container || !mainBoard || !stinger) return;

        const localColor = this._getPlayerColor(this.steamNetworking?.steamId) || '#4fd1c5';
        const accentRgb = this._parseAccentColorToRgb(localColor);
        const prefersReducedMotion = typeof window !== 'undefined'
            && typeof window.matchMedia === 'function'
            && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        container.style.setProperty('--round-start-accent', localColor);
        container.style.setProperty('--round-start-accent-rgb', `${accentRgb[0]}, ${accentRgb[1]}, ${accentRgb[2]}`);

        const roundText = stinger.querySelector('.online-round-stinger__round');
        const subtitle = stinger.querySelector('.online-round-stinger__subtitle');
        if (roundText) {
            roundText.textContent = `ROUND ${this.roundNumber}`;
        }
        if (subtitle) {
            subtitle.textContent = this._buildRoundStingerSubtitle();
        }

        const opponentCards = Array.from(container.querySelectorAll('.opponent-mini-board'));
        opponentCards.forEach((card, index) => {
            card.style.setProperty('--round-start-delay', `${Math.min(index * 45, 180)}ms`);
            card.classList.remove('round-start-burst');
        });

        container.classList.remove('round-start-pulse');
        mainBoard.classList.remove('round-start-burst');
        mainBoard.classList.remove('round-start-burst-reduced');
        stinger.classList.remove('is-active');
        stinger.classList.remove('is-active-reduced');

        this.roundStingerRunId += 1;
        const runId = this.roundStingerRunId;

        if (prefersReducedMotion) {
            stinger.classList.add('is-active-reduced');
            mainBoard.classList.add('round-start-burst-reduced');
            this.roundStingerTimer = setTimeout(() => {
                if (runId !== this.roundStingerRunId) return;
                mainBoard.classList.remove('round-start-burst-reduced');
                stinger.classList.remove('is-active-reduced');
                opponentCards.forEach((card) => {
                    card.style.removeProperty('--round-start-delay');
                });
                this.roundStingerTimer = null;
            }, 360);
            return;
        }

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                if (runId !== this.roundStingerRunId) return;
                container.classList.add('round-start-pulse');
                mainBoard.classList.add('round-start-burst');
                stinger.classList.add('is-active');
                opponentCards.forEach((card) => card.classList.add('round-start-burst'));
            });
        });

        if (this.roundStingerTimer) {
            clearTimeout(this.roundStingerTimer);
        }
        this.roundStingerTimer = setTimeout(() => {
            if (runId !== this.roundStingerRunId) return;
            container.classList.remove('round-start-pulse');
            mainBoard.classList.remove('round-start-burst');
            stinger.classList.remove('is-active');
            opponentCards.forEach((card) => {
                card.classList.remove('round-start-burst');
                card.style.removeProperty('--round-start-delay');
            });
            this.roundStingerTimer = null;
        }, 850);
    }

    _buildRoundStingerSubtitle() {
        const config = this.ffaGameState?.matchConfig || {};
        const goal = Number(config.endConditionValue) || 0;

        switch (config.endCondition) {
            case 'frags':
                return `FIRST TO ${goal || 10} FRAGS`;
            case 'points':
                return `FIRST TO ${(goal || 10) * 1000} POINTS`;
            case 'lines':
                return `FIRST TO ${goal || 40} LINES`;
            case 'time':
                return `${goal || 3} MINUTE SPRINT`;
            case 'never':
                return 'ENDLESS BATTLE';
            default:
                return 'STAY SHARP';
        }
    }

    _parseAccentColorToRgb(color) {
        if (!color || typeof color !== 'string') return [79, 209, 197];

        const trimmed = color.trim();

        if (trimmed.startsWith('#')) {
            const hex = trimmed.slice(1);
            if (hex.length === 3) {
                return hex.split('').map((value) => parseInt(value + value, 16));
            }
            if (hex.length === 6) {
                return [
                    parseInt(hex.slice(0, 2), 16),
                    parseInt(hex.slice(2, 4), 16),
                    parseInt(hex.slice(4, 6), 16),
                ];
            }
        }

        const rgbMatch = trimmed.match(/rgba?\(([^)]+)\)/i);
        if (rgbMatch && rgbMatch[1]) {
            const channels = rgbMatch[1]
                .split(',')
                .slice(0, 3)
                .map((value) => Number.parseInt(value.trim(), 10))
                .map((value) => (Number.isNaN(value) ? 0 : Math.max(0, Math.min(255, value))));
            if (channels.length === 3) {
                return channels;
            }
        }

        return [79, 209, 197];
    }

    _clearRoundStartEffects() {
        if (this.roundStingerTimer) {
            clearTimeout(this.roundStingerTimer);
            this.roundStingerTimer = null;
        }

        const container = document.getElementById('online-multiplayer-container');
        const mainBoard = document.getElementById('online-main-board');

        if (container) {
            container.classList.remove('round-start-pulse');
            const opponentCards = container.querySelectorAll('.opponent-mini-board.round-start-burst');
            opponentCards.forEach((card) => {
                card.classList.remove('round-start-burst');
                card.style.removeProperty('--round-start-delay');
            });
        }

        if (mainBoard) {
            mainBoard.classList.remove('round-start-burst');
            mainBoard.classList.remove('round-start-burst-reduced');
        }

        if (this.roundStingerElement) {
            this.roundStingerElement.classList.remove('is-active');
            this.roundStingerElement.classList.remove('is-active-reduced');
        }
    }

    /**
     * Update the garbage meter display
     * PERF: Caches DOM elements and only updates when values change
     */
    _updateGarbageMeter(queueOrAmount) {
        // PERF: Initialize garbage meter element cache on first call
        if (!this._garbageElements) {
            const bar = document.getElementById('online-garbage-bar');
            this._garbageElements = {
                bar,
                fill: bar?.querySelector('.garbage-fill'),
                segments: bar?.querySelector('.garbage-segments'),
                value: document.getElementById('online-garbage-value'),
            };
            this._lastGarbageAmount = -1;
            this._lastGarbageQueueSignature = '';
        }

        const isQueue = queueOrAmount && typeof queueOrAmount.getTotalLines === 'function';
        const amount = isQueue ? queueOrAmount.getTotalLines() : Number(queueOrAmount || 0);

        // PERF: Skip DOM updates if amount hasn't changed
        if (amount === this._lastGarbageAmount) {
            // Still need to check queue signature for segment rendering
            if (isQueue) {
                const signature = queueOrAmount.entries?.map((e) => `${e.type}:${e.lines}`).join('|') || '';
                if (signature === this._lastGarbageQueueSignature) return;
                this._lastGarbageQueueSignature = signature;
            } else {
                return;
            }
        }
        this._lastGarbageAmount = amount;

        const { bar, fill, segments, value: valueEl } = this._garbageElements;

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

    _updateInterpolationNetworkStats(players = []) {
        if (!this.networkStats || !this.snapshotInterpolator || !this._adaptiveInterpEnabled) return;
        const localId = this.steamNetworking?.steamId;
        const opponent = players.find((p) => p && p.id !== localId && p.steamId !== localId);
        if (!opponent) {
            this.networkStats.interpDelayMs = null;
            this.networkStats.interpJitterMs = null;
            this.networkStats.interpBuffer = null;
            return;
        }

        const stats = this.snapshotInterpolator.getStats(opponent.steamId || opponent.id);
        this.networkStats.interpDelayMs = stats.interpolationDelay;
        this.networkStats.interpJitterMs = stats.jitterMs;
        this.networkStats.interpBuffer = stats.bufferSize;
        this._updateNetworkHud();
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

    _syncPlayerColors(players, playerCount = null) {
        if (!players) return;
        // PERF: Use playerCount if provided (for pre-allocated payloads)
        const count = playerCount ?? players.length;
        for (let i = 0; i < count; i++) {
            const player = players[i];
            if (player?.steamId && player.color) {
                this.playerColors.set(player.steamId, player.color);
            }
        }
    }

    _getPlayerColor(steamId) {
        if (!steamId) return null;
        if (this.playerColors.has(steamId)) {
            return this.playerColors.get(steamId);
        }
        const stringId = String(steamId);
        if (this.playerColors.has(stringId)) {
            return this.playerColors.get(stringId);
        }
        const player = this.ffaGameState?.players?.get(steamId)
            || this.ffaGameState?.players?.get(stringId);
        return player?.color || null;
    }

    _getPlayerName(steamId) {
        if (!steamId) return null;
        const stringId = String(steamId);
        const player = this.ffaGameState?.players?.get(steamId)
            || this.ffaGameState?.players?.get(stringId);
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
     * PERF: Caches DOM elements and only updates when values change
     */
    _updateLocalStats(state) {
        // PERF: Initialize stat element cache on first call
        if (!this._statElements) {
            this._statElements = {
                frags: document.getElementById('online-frags'),
                deaths: document.getElementById('online-deaths'),
                score: document.getElementById('online-score'),
                lines: document.getElementById('online-lines'),
            };
            this._lastStats = { frags: -1, deaths: -1, score: -1, lines: -1 };
        }

        // PERF: Only update DOM when values actually change
        const frags = state.frags || 0;
        const deaths = state.deaths || 0;
        const score = state.score || 0;
        const lines = state.lines || 0;

        if (frags !== this._lastStats.frags && this._statElements.frags) {
            this._statElements.frags.textContent = frags;
            this._lastStats.frags = frags;
        }
        if (deaths !== this._lastStats.deaths && this._statElements.deaths) {
            this._statElements.deaths.textContent = deaths;
            this._lastStats.deaths = deaths;
        }
        if (score !== this._lastStats.score && this._statElements.score) {
            this._statElements.score.textContent = score.toLocaleString();
            this._lastStats.score = score;
        }
        if (lines !== this._lastStats.lines && this._statElements.lines) {
            this._statElements.lines.textContent = lines;
            this._lastStats.lines = lines;
        }
    }

    /**
     * Set up input handlers
     */
    _setupInputHandlers() {
        console.log('[OnlineMultiplayer] Input handlers set up');
    }

    _configureLocalInputHooks(gameState) {
        if (!gameState?.setLocalInputHooks) {
            return;
        }

        gameState.setLocalInputHooks({
            advance: (currentTime, delta) => this._advanceHeldGameplayInput(currentTime, delta),
            reset: () => this._resetHeldGameplayInput(),
        });
    }

    _advanceHeldGameplayInput(currentTime, delta) {
        if (typeof window !== 'undefined') {
            window.inputController?.updateDAS?.(delta);
        }
        this.deps.gamepadController?.advanceGameplayInput?.(currentTime);
    }

    _resetHeldGameplayInput() {
        if (typeof window !== 'undefined') {
            window.inputController?.clearTimers?.();
        }
        this.deps.gamepadController?.clearAllDasTimers?.();
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

        // Initialize BoardJuice for reactive board motion
        this._initBoardJuice();

        window.move = (dir) => {
            const gameState = this.mainBoardScene?.gameState || this.ffaGameState?.players?.get(this.steamNetworking?.steamId)?.gameState;
            if (gameState?.hitStopRemaining > 0) return false;
            this.ffaGameState?.sendInput('move', { direction: dir });
            // Board juice: nudge + tilt on move
            if (this.boardJuice) {
                this.boardJuice.nudge(dir * 1.5, 0);
                this.boardJuice.tilt(dir * 0.4);
            }
        };

        window.rotate = (dir) => {
            const gameState = this.mainBoardScene?.gameState || this.ffaGameState?.players?.get(this.steamNetworking?.steamId)?.gameState;
            if (gameState?.hitStopRemaining > 0) return;
            this.ffaGameState?.sendInput('rotate', { direction: dir });
            // Board juice: tilt on rotate
            if (this.boardJuice) {
                this.boardJuice.tilt(dir === 'left' ? -0.3 : 0.3);
            }
        };

        window.softDrop = () => {
            const gameState = this.mainBoardScene?.gameState || this.ffaGameState?.players?.get(this.steamNetworking?.steamId)?.gameState;
            if (gameState?.hitStopRemaining > 0) return false;
            this.ffaGameState?.sendInput('drop', { type: 'soft' });
        };

        window.hardDrop = () => {
            const gameState = this.mainBoardScene?.gameState || this.ffaGameState?.players?.get(this.steamNetworking?.steamId)?.gameState;
            if (gameState?.hitStopRemaining > 0) return;
            this.ffaGameState?.sendInput('drop', { type: 'hard' });
            // Board juice: dip + bounce on hard drop
            if (this.boardJuice) {
                this.boardJuice.dip(3);
                this.boardJuice.bounce();
            }
        };
    }

    /**
     * Initialize BoardJuice for reactive board motion
     * @private
     */
    _initBoardJuice() {
        if (this.boardJuice) {
            this.boardJuice.destroy();
            this.boardJuice = null;
        }

        // Online mode: target the main board container
        const mainBoard = document.getElementById('online-main-board');
        const boardSection = mainBoard?.closest('.player-board-section') || mainBoard;
        if (boardSection) {
            this.boardJuice = new BoardJuice(boardSection);
        }
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

        const localColor = this._getPlayerColor(this.ffaGameState.localPlayerId);
        const payload = {
            playerName: this.ffaGameState.network.playerName,
            message: text,
            steamId: this.ffaGameState.localPlayerId,
            timestamp: Date.now(),
            color: localColor,
        };

        // Also add to local chat immediately
        if (this.chat) {
            this.chat.addMessage({
                author: 'You',
                text,
                color: localColor,
            });
        }

        // Add to persistent history
        if (this.ffaGameState.chatHistory) {
            this.ffaGameState.chatHistory.push(payload);
        }

        // Deliver: the host fans out to all peers; a peer sends to the host, which
        // rebroadcasts. (broadcastToAll hard-guards non-hosts, so peers MUST relay
        // via the host or their message is silently dropped on real Steam.)
        const network = this.ffaGameState.network;
        if (network.isHost) {
            network.broadcastToAll('game:chat', payload);
        } else if (network.hostSteamId) {
            network.sendP2PMessage(network.hostSteamId, 'game:chat', payload);
        }
    }

    /**
     * Phase 3: Handle hidden-tab behavior for online multiplayer.
     * Pauses local visual/input work when tab is hidden but keeps
     * the network game loop alive so snapshots continue flowing.
     */
    _setupVisibilityHandler() {
        if (this._visibilityHandler) return;

        this._visibilityHandler = () => {
            if (!this.isInMatch) return;

            if (document.hidden) {
                // Pause local input to prevent ghost key repeats
                this._resetHeldGameplayInput();
                if (typeof window !== 'undefined' && window.inputController) {
                    window.inputController.keyMap = {};
                }
                console.log('[OnlineMultiplayer] Tab hidden - local input paused, network loop continues');
            } else {
                // Reset input timing on return to prevent burst moves
                this._resetHeldGameplayInput();
                if (typeof window !== 'undefined' && window.inputController) {
                    window.inputController.keyMap = {};
                }
                console.log('[OnlineMultiplayer] Tab visible - local input resumed');
            }
        };

        document.addEventListener('visibilitychange', this._visibilityHandler);
        this.cleanupHandlers.push(() => {
            if (this._visibilityHandler) {
                document.removeEventListener('visibilitychange', this._visibilityHandler);
                this._visibilityHandler = null;
            }
        });
    }

    // [removed 2026-06-23] _startOnlineGameLoop() was DEAD CODE — never called, and it
    // called this.ffaGameState.update(delta) which does not exist on FFAGameStateP2P
    // (the real loop is UnifiedMultiplayerLoop driving FFAGameStateP2P.onUpdate). It was
    // deleted so nobody "revives" it by wiring it up (it would throw / double-broadcast).
    // The orphaned _broadcastGameState()/_updateHostUI() helpers below belonged to it.

    /**
     * Broadcast full game state to all peers (host only)
     */
    _broadcastGameState() {
        if (!this.steamNetworking.isHost || !this.ffaGameState) return;

        const state = this.ffaGameState.getFullState();
        this.steamNetworking.broadcastSnapshot(MessageTypes.GAME_STATE_FULL, state);
    }

    /**
     * GPU-contention relief, NOW DEFAULT OFF (opt-IN): originally this paused the animated
     * WebGPU/Three.js ambient theme during an online match (A5), because a mid-range peer
     * (RTX 3070) logged sustained frame drops + a 0.5 render-scale that made the peer's
     * RAF-coupled prediction choppy. Since then the peer feel was fixed structurally
     * (PEER-OWNS-BOARD), so the theme no longer needs to be frozen — and freezing it left
     * the background visibly static during online play (single-player keeps it animating).
     * So the theme now KEEPS ANIMATING online exactly like single-player. Low-end machines
     * can still restore the relief by OPTING IN with localStorage 'serenity.mpSuspendTheme'='1'.
     * ALWAYS resumed in _cleanupGameRendering (no-op when not suspended).
     */
    _suspendThemeForMatch() {
        try {
            const optedIn = typeof localStorage !== 'undefined' && localStorage.getItem('serenity.mpSuspendTheme') === '1';
            if (optedIn && !this._themeSuspendedForMatch && window.themeManager?.suspendThemes) {
                window.themeManager.suspendThemes();
                this._themeSuspendedForMatch = true;
                console.log('[OnlineMultiplayer] Heavy theme suspended for match (opt-in GPU-contention relief; serenity.mpSuspendTheme=1)');
            }
        } catch (err) {
            // Never let theme control break the match.
            console.warn('[OnlineMultiplayer] suspendThemeForMatch failed:', err?.message);
        }
    }

    _resumeThemeAfterMatch() {
        try {
            if (this._themeSuspendedForMatch && window.themeManager?.resumeThemes) {
                this._themeSuspendedForMatch = false;
                window.themeManager.resumeThemes();
                console.log('[OnlineMultiplayer] Theme resumed after match');
            }
        } catch (err) {
            console.warn('[OnlineMultiplayer] resumeThemeAfterMatch failed:', err?.message);
        }
    }

    /**
     * Clean up game rendering
     */
    _cleanupGameRendering() {
        this._resumeThemeAfterMatch();
        this._clearRoundStartEffects();
        this.roundStingerRunId += 1;
        if (this.roundStingerElement) {
            this.roundStingerElement.remove();
            this.roundStingerElement = null;
        }

        // Stop game loop
        if (this.gameLoopId) {
            cancelAnimationFrame(this.gameLoopId);
            this.gameLoopId = null;
        }

        // Stop the spectator render driver BEFORE the opponentWatchManager is destroyed
        // below, so no queued frame calls _processRenderFrame on a torn-down manager.
        this._stopSpectatorRenderLoop();
        this._latestSnapshotPlayers = null;

        // Destroy Phaser game
        if (this.mainPhaserGame) {
            this.mainPhaserGame.destroy(true);
            this.mainPhaserGame = null;
            this.mainBoardScene = null;
        }

        // Clean up BoardJuice
        if (this.boardJuice) {
            this.boardJuice.destroy();
            this.boardJuice = null;
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
    async onStart(options = {}) {
        console.log('[OnlineMultiplayer] Starting online game...');

        // For online multiplayer, the game starts through the lobby flow
        // If onStart is called before lobby selection, just wait for user interaction
        if (!this.lobbyBrowser) {
            console.log('[OnlineMultiplayer] Waiting for lobby browser initialization...');
            return;
        }

        // Now actually start if we have a lobby
        await super.onStart();

        if (options?.lobbyId) {
            await this.handleJoinLobby(options.lobbyId);
            return;
        }

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

        this._clearLobbyRichPresence();

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
        this.playerListRichPresenceUnsub = null;
        this.networkHandlersRegistered = false;
        this.lastPlayerSignature = '';

        if (this.matchResultsModal) {
            this.matchResultsModal.destroy();
            this.matchResultsModal = null;
        }

        console.log('[OnlineMultiplayer] ✅ Deactivated');
    }

    /**
     * Update Steam Rich Presence for lobby joins (enables "Join Game")
     */
    async _setLobbyRichPresence() {
        if (!this.currentLobbyId) {
            return;
        }

        const playerCount = this.ffaGameState?.players?.size || 1;

        await Promise.all([
            steamService.setRichPresenceKey('connect', `+connect_lobby ${this.currentLobbyId}`),
            steamService.setRichPresenceKey('steam_player_group', String(this.currentLobbyId)),
            steamService.setRichPresenceKey('steam_player_group_size', String(playerCount)),
        ]);
    }

    /**
     * Clear lobby-specific Rich Presence keys
     */
    _clearLobbyRichPresence() {
        steamService.clearRichPresenceKey('connect');
        steamService.clearRichPresenceKey('steam_player_group');
        steamService.clearRichPresenceKey('steam_player_group_size');
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
