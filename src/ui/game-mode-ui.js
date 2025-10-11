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
        this.multiplayerBtn = document.getElementById('multiplayer-btn');

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

        if (this.multiplayerBtn) {
            this.multiplayerBtn.addEventListener('click', () => {
                this.selectMode(GAME_MODES.MULTIPLAYER);
            });
        }
    }

    /**
     * Select a game mode
     * @param {string} mode - Game mode ('single' or 'multiplayer')
     */
    selectMode(mode) {
        this.currentMode = mode;

        // Update button states
        if (this.singlePlayerBtn && this.multiplayerBtn) {
            this.singlePlayerBtn.classList.toggle('active', mode === GAME_MODES.SINGLE_PLAYER);
            this.multiplayerBtn.classList.toggle('active', mode === GAME_MODES.MULTIPLAYER);
        }

        // Update container visibility (will be applied when game starts)
        this.updateContainerVisibility();

        // Dispatch event
        window.dispatchEvent(new CustomEvent('gameModeChanged', {
            detail: { mode }
        }));
    }

    /**
     * Update container visibility based on current mode
     */
    updateContainerVisibility() {
        if (this.singlePlayerContainer && this.multiplayerContainer) {
            if (this.currentMode === GAME_MODES.SINGLE_PLAYER) {
                this.singlePlayerContainer.style.display = '';
                this.multiplayerContainer.style.display = 'none';
            } else {
                this.singlePlayerContainer.style.display = 'none';
                this.multiplayerContainer.style.display = 'flex';
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
