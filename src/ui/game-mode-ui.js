/**
 * @fileoverview Game mode UI management
 * Handles switching between single player and multiplayer layouts
 */

import { GAME_MODES } from '../core/constants.js';
import steamService from '../core/steam/steam-service.js';
import { STEAM_EVENTS } from '../core/steam/steam-config.js';

/**
 * Game mode UI manager
 */
export class GameModeUI {
    constructor() {
        this.currentMode = GAME_MODES.SINGLE_PLAYER;
        this.singlePlayerContainer = document.getElementById('single-player-container');
        this.multiplayerContainer = document.getElementById('multiplayer-container');
        this.steamUnsubscribers = [];

        // Support both old button IDs and new card IDs
        this.singlePlayerBtn = document.getElementById('single-player-btn') || document.getElementById('single-player-card-btn');
        this.localMultiplayerBtn = document.getElementById('local-multiplayer-btn') || document.getElementById('local-multiplayer-card-btn');
        this.onlineMultiplayerBtn = document.getElementById('online-multiplayer-btn') || document.getElementById('online-multiplayer-card-btn');
        this.serenityBtn = document.getElementById('serenity-btn') || document.getElementById('serenity-card-btn');
        this.infinityBtn = document.getElementById('infinity-btn') || document.getElementById('infinity-card-btn');
        this.odysseyBtn = document.getElementById('odyssey-btn') || document.getElementById('odyssey-card-btn');

        // Mode description elements (may not exist with card design)
        this.singlePlayerDesc = document.getElementById('single-player-desc');
        this.localMultiplayerDesc = document.getElementById('local-multiplayer-desc');
        this.onlineMultiplayerDesc = document.getElementById('online-multiplayer-desc');
        this.serenityDesc = document.getElementById('serenity-desc');
        this.infinityDesc = document.getElementById('infinity-desc');
        this.odysseyDesc = document.getElementById('odyssey-desc');

        this.setupModeButtons();
        this.setupSteamListeners();
        this.updateOnlineMultiplayerAvailability();
    }

    /**
     * Setup mode selection buttons/cards
     */
    setupModeButtons() {
        if (this.singlePlayerBtn) {
            this.singlePlayerBtn.addEventListener('click', async () => {
                await this.selectModeAndStart(GAME_MODES.SINGLE_PLAYER);
            });
        }

        if (this.localMultiplayerBtn) {
            this.localMultiplayerBtn.addEventListener('click', async () => {
                await this.selectModeAndStart(GAME_MODES.LOCAL_MULTIPLAYER);
            });
        }

        if (this.onlineMultiplayerBtn) {
            this.onlineMultiplayerBtn.addEventListener('click', async () => {
                if (this.isOnlineMultiplayerDisabled()) {
                    return;
                }
                await this.selectModeAndStart(GAME_MODES.ONLINE_MULTIPLAYER);
            });
        }

        if (this.serenityBtn) {
            this.serenityBtn.addEventListener('click', async () => {
                await this.selectModeAndStart(GAME_MODES.SERENITY);
            });
        }

        if (this.infinityBtn) {
            this.infinityBtn.addEventListener('click', async () => {
                await this.selectModeAndStart(GAME_MODES.INFINITY);
            });
        }

        if (this.odysseyBtn) {
            this.odysseyBtn.addEventListener('click', async () => {
                await this.selectModeAndStart(GAME_MODES.ODYSSEY);
            });
        }
    }

    /**
     * Select mode and immediately start the game (for card-based UI)
     * @param {string} mode - Game mode to select and start
     */
    async selectModeAndStart(mode) {
        if (mode === GAME_MODES.ONLINE_MULTIPLAYER && this.isOnlineMultiplayerDisabled()) {
            return;
        }
        // Select the mode
        this.selectMode(mode);

        // Dispatch custom event to trigger game start
        window.dispatchEvent(
            new CustomEvent('startGameWithMode', {
                detail: { mode },
            }),
        );
    }

    /**
     * Select a game mode
     * @param {string} mode - Game mode ('single', 'local-multiplayer', or 'online-multiplayer')
     */
    selectMode(mode) {
        this.currentMode = mode;

        // Update button states
        if (this.singlePlayerBtn) {
            this.singlePlayerBtn.classList.toggle('active', mode === GAME_MODES.SINGLE_PLAYER);
        }
        if (this.localMultiplayerBtn) {
            this.localMultiplayerBtn.classList.toggle('active', mode === GAME_MODES.LOCAL_MULTIPLAYER);
        }
        if (this.onlineMultiplayerBtn) {
            this.onlineMultiplayerBtn.classList.toggle('active', mode === GAME_MODES.ONLINE_MULTIPLAYER);
        }
        if (this.serenityBtn) {
            this.serenityBtn.classList.toggle('active', mode === GAME_MODES.SERENITY);
        }
        if (this.infinityBtn) {
            this.infinityBtn.classList.toggle('active', mode === GAME_MODES.INFINITY);
        }
        if (this.odysseyBtn) {
            this.odysseyBtn.classList.toggle('active', mode === GAME_MODES.ODYSSEY);
        }

        // Update description visibility
        this.updateDescriptionVisibility();

        // NOTE: Container visibility is no longer updated here
        // It will be handled by the GameModeManager when the mode is activated

        // Dispatch event
        window.dispatchEvent(
            new CustomEvent('gameModeChanged', {
                detail: { mode },
            }),
        );
    }

    /**
     * Update description visibility based on current mode
     */
    updateDescriptionVisibility() {
        if (this.singlePlayerDesc) {
            this.singlePlayerDesc.classList.toggle('active', this.currentMode === GAME_MODES.SINGLE_PLAYER);
        }
        if (this.localMultiplayerDesc) {
            this.localMultiplayerDesc.classList.toggle('active', this.currentMode === GAME_MODES.LOCAL_MULTIPLAYER);
        }
        if (this.onlineMultiplayerDesc) {
            this.onlineMultiplayerDesc.classList.toggle('active', this.currentMode === GAME_MODES.ONLINE_MULTIPLAYER);
        }
        if (this.serenityDesc) {
            this.serenityDesc.classList.toggle('active', this.currentMode === GAME_MODES.SERENITY);
        }
        if (this.infinityDesc) {
            this.infinityDesc.classList.toggle('active', this.currentMode === GAME_MODES.INFINITY);
        }
        if (this.odysseyDesc) {
            this.odysseyDesc.classList.toggle('active', this.currentMode === GAME_MODES.ODYSSEY);
        }
    }

    setupSteamListeners() {
        if (!steamService?.on) return;
        this.steamUnsubscribers.push(
            steamService.on(STEAM_EVENTS.CONNECTED, () => this.updateOnlineMultiplayerAvailability()),
            steamService.on(STEAM_EVENTS.DISCONNECTED, () => this.updateOnlineMultiplayerAvailability()),
            steamService.on(STEAM_EVENTS.STATE_CHANGED, () => this.updateOnlineMultiplayerAvailability()),
        );
    }

    updateOnlineMultiplayerAvailability() {
        if (!this.onlineMultiplayerBtn) return;
        const isOnline = !!steamService?.isOnline;
        this.setOnlineMultiplayerEnabled(isOnline);
    }

    setOnlineMultiplayerEnabled(isEnabled) {
        if (!this.onlineMultiplayerBtn) return;
        this.onlineMultiplayerBtn.classList.toggle('steam-disabled', !isEnabled);
        this.onlineMultiplayerBtn.dataset.disabled = isEnabled ? 'false' : 'true';
        this.onlineMultiplayerBtn.dataset.disabledLabel = isEnabled ? '' : 'Steam required';
        this.onlineMultiplayerBtn.setAttribute('aria-disabled', String(!isEnabled));
        this.onlineMultiplayerBtn.setAttribute('tabindex', isEnabled ? '0' : '-1');
        this.onlineMultiplayerBtn.title = isEnabled ? '' : 'Requires Steam connection';
    }

    isOnlineMultiplayerDisabled() {
        if (!this.onlineMultiplayerBtn) return false;
        return this.onlineMultiplayerBtn.dataset.disabled === 'true';
    }

    /**
     * Update container visibility based on current mode
     */
    updateContainerVisibility() {
        const singlePlayerStage = document.querySelector('.single-player-stage');

        if (this.singlePlayerContainer && this.multiplayerContainer) {
            if (this.currentMode === GAME_MODES.SINGLE_PLAYER || this.currentMode === GAME_MODES.INFINITY) {
                // Show single player stage and container (infinity uses same layout as single player)
                if (singlePlayerStage) singlePlayerStage.style.display = '';
                this.singlePlayerContainer.style.display = '';
                this.multiplayerContainer.style.display = 'none';
            } else if (this.currentMode === GAME_MODES.LOCAL_MULTIPLAYER) {
                // Hide single player, show multiplayer
                if (singlePlayerStage) singlePlayerStage.style.display = 'none';
                this.singlePlayerContainer.style.display = 'none';
                this.multiplayerContainer.style.display = 'flex';
            } else if (this.currentMode === GAME_MODES.ONLINE_MULTIPLAYER) {
                // Online multiplayer uses its own UI system
                if (singlePlayerStage) singlePlayerStage.style.display = 'none';
                this.singlePlayerContainer.style.display = 'none';
                this.multiplayerContainer.style.display = 'none';
            } else if (this.currentMode === GAME_MODES.SERENITY) {
                // Serenity mode hides game boards
                if (singlePlayerStage) singlePlayerStage.style.display = 'none';
                this.singlePlayerContainer.style.display = 'none';
                this.multiplayerContainer.style.display = 'none';
            } else if (this.currentMode === GAME_MODES.ODYSSEY) {
                // Odyssey mode handles its own UI
                if (singlePlayerStage) singlePlayerStage.style.display = 'none';
                this.singlePlayerContainer.style.display = 'none';
                this.multiplayerContainer.style.display = 'none';
            }
        }
    }

    /**
     * Get current game mode
     * @returns {string} Current game mode
     */
    getMode() {
        return this.currentMode;
    }

    /**
     * Set mode from settings
     * @param {string} mode - Game mode
     */
    setModeFromSettings(mode) {
        this.selectMode(mode);
    }
}
