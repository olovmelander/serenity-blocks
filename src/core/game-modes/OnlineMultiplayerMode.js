import { BaseGameMode } from './BaseGameMode.js';
import { GAME_MODES } from '../constants.js';
import { SteamNetworking } from '../steam/steam-networking.js';
import { FFAGameStateP2P } from '../multiplayer/ffa-p2p-game-state.js';
import { LobbyBrowser } from '../../ui/lobby-browser.js';
import { LobbyWaitingRoom } from '../../ui/lobby-waiting-room.js';
import { MatchConfigModal } from '../../ui/match-config-modal.js';
import { onMultiplayerEvent, MULTIPLAYER_EVENTS } from '../../events/multiplayer-events.js';

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
        
        // State
        this.currentLobbyId = null;
        this.isInMatch = false;
        
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
            () => this.handleLobbyBrowserCancelled()
        );

        // Create match config modal
        this.matchConfigModal = new MatchConfigModal(
            (config) => this.handleCreateLobby(config)
        );

        console.log('[OnlineMultiplayer] ✅ Lobby UI initialized');
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
                this.steamNetworking.steamId
            );
            
            // Announce join to host
            this.ffaGameState.announceJoin();
            
            this.currentLobbyId = lobbyId;
            
            // Show waiting room
            this.showWaitingRoom();
            
            console.log(`[OnlineMultiplayer] ✅ Joined lobby successfully`);
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
                this.steamNetworking.steamId
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
                () => this.handleLeaveLobby()
            );
        } else {
            // Update game state reference
            this.lobbyWaitingRoom.gameState = this.ffaGameState;
        }

        // Show waiting room
        this.lobbyWaitingRoom.show();

        // Listen for match start event (for peers)
        const unsubMatchStarted = onMultiplayerEvent(
            MULTIPLAYER_EVENTS.MATCH_STARTED,
            () => this.handleMatchStart()
        );
        this.cleanupHandlers.push(unsubMatchStarted);

        console.log('[OnlineMultiplayer] ✅ Waiting room shown');
    }

    /**
     * Handle leaving lobby
     */
    handleLeaveLobby() {
        console.log('[OnlineMultiplayer] Handling lobby leave...');

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
     * Handle match start
     */
    handleMatchStart() {
        console.log('[OnlineMultiplayer] Match starting...');

        // Hide waiting room
        if (this.lobbyWaitingRoom) {
            this.lobbyWaitingRoom.hide();
        }

        // TODO: Initialize multiplayer game UI and start rendering
        // This will involve:
        // 1. Show multiplayer game container
        // 2. Create board scenes for each player
        // 3. Start unified game loop
        // 4. Connect input handlers

        this.isInMatch = true;

        console.log('[OnlineMultiplayer] ✅ Match started');

        // Temporary: Show alert
        alert('Match is starting! (Game UI initialization coming next)');
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
            // Clean up match
            this.isInMatch = false;
            
            // TODO: Show match results
            // TODO: Return to lobby browser or waiting room
        }

        console.log('[OnlineMultiplayer] ✅ Game stopped');
    }

    /**
     * Called when mode is deselected
     */
    async onDeactivate() {
        await super.onDeactivate();

        console.log('[OnlineMultiplayer] Deactivating...');

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
