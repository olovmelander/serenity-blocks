/**
 * @fileoverview Game mode UI management
 * Handles switching between single player and multiplayer layouts
 */

import { GAME_MODES } from '../core/constants.js';

/**
 * Game mode UI manager
 */
export class GameModeUI {
    constructor() {
        this.currentMode = GAME_MODES.SINGLE_PLAYER;
        this.singlePlayerContainer = document.getElementById('single-player-container');
        this.multiplayerContainer = document.getElementById('multiplayer-container');
        this.singlePlayerBtn = document.getElementById('single-player-btn');
        this.localMultiplayerBtn = document.getElementById('local-multiplayer-btn');
        this.onlineMultiplayerBtn = document.getElementById('online-multiplayer-btn');
        this.serenityBtn = document.getElementById('serenity-btn');

        // Mode description elements
        this.singlePlayerDesc = document.getElementById('single-player-desc');
        this.localMultiplayerDesc = document.getElementById('local-multiplayer-desc');
        this.onlineMultiplayerDesc = document.getElementById('online-multiplayer-desc');
        this.serenityDesc = document.getElementById('serenity-desc');

        this.setupModeButtons();
    }

    /**
     * Setup mode selection buttons
     */
    setupModeButtons() {
        if (this.singlePlayerBtn) {
            this.singlePlayerBtn.addEventListener('click', () => {
                this.selectMode(GAME_MODES.SINGLE_PLAYER);
            });
        }

        if (this.localMultiplayerBtn) {
            this.localMultiplayerBtn.addEventListener('click', () => {
                this.selectMode(GAME_MODES.LOCAL_MULTIPLAYER);
            });
        }

        if (this.onlineMultiplayerBtn) {
            this.onlineMultiplayerBtn.addEventListener('click', () => {
                this.selectMode(GAME_MODES.ONLINE_MULTIPLAYER);
            });
        }

        if (this.serenityBtn) {
            this.serenityBtn.addEventListener('click', () => {
                this.selectMode(GAME_MODES.SERENITY);
            });
        }
    }

    /**
     * Select a game mode
     * @param {string} mode - Game mode ('single', 'local-multiplayer', or 'online-multiplayer')
     */
    selectMode(mode) {
        this.currentMode = mode;

        // Update button states
        if (this.singlePlayerBtn && this.localMultiplayerBtn && this.onlineMultiplayerBtn && this.serenityBtn) {
            this.singlePlayerBtn.classList.toggle('active', mode === GAME_MODES.SINGLE_PLAYER);
            this.localMultiplayerBtn.classList.toggle('active', mode === GAME_MODES.LOCAL_MULTIPLAYER);
            this.onlineMultiplayerBtn.classList.toggle('active', mode === GAME_MODES.ONLINE_MULTIPLAYER);
            this.serenityBtn.classList.toggle('active', mode === GAME_MODES.SERENITY);
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
        if (this.singlePlayerDesc && this.localMultiplayerDesc && this.onlineMultiplayerDesc && this.serenityDesc) {
            this.singlePlayerDesc.classList.toggle('active', this.currentMode === GAME_MODES.SINGLE_PLAYER);
            this.localMultiplayerDesc.classList.toggle('active', this.currentMode === GAME_MODES.LOCAL_MULTIPLAYER);
            this.onlineMultiplayerDesc.classList.toggle('active', this.currentMode === GAME_MODES.ONLINE_MULTIPLAYER);
            this.serenityDesc.classList.toggle('active', this.currentMode === GAME_MODES.SERENITY);
        }
    }

    /**
     * Update container visibility based on current mode
     */
    updateContainerVisibility() {
        if (this.singlePlayerContainer && this.multiplayerContainer) {
            if (this.currentMode === GAME_MODES.SINGLE_PLAYER) {
                this.singlePlayerContainer.style.display = '';
                this.multiplayerContainer.style.display = 'none';
            } else if (this.currentMode === GAME_MODES.LOCAL_MULTIPLAYER) {
                this.singlePlayerContainer.style.display = 'none';
                this.multiplayerContainer.style.display = 'flex';
            } else if (this.currentMode === GAME_MODES.ONLINE_MULTIPLAYER) {
                // Online multiplayer uses its own UI system
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
