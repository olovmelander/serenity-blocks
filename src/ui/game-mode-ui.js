/**
 * @fileoverview Game mode UI management
 * Handles switching between single player and multiplayer layouts
 */

import { GAME_MODES } from '../core/constants.js';
import steamService from '../core/steam/steam-service.js';
import { STEAM_EVENTS } from '../core/steam/steam-config.js';

// Dev-only: allow ONLINE MP without a real Steam connection so the MOCK transport
// (BroadcastChannel + localStorage, used in the browser / no-Steam build) can be tested
// on ONE machine across two browser windows. Enabled by ?localMp=host|join, ?localMpTest=1,
// or localStorage 'serenity.localMpTest'='1'. The packaged Steam build is unaffected unless
// the flag is explicitly set.
export function isLocalMpTestMode() {
    try {
        const p = new URLSearchParams(window.location.search);
        if (p.get('localMp') === 'host' || p.get('localMp') === 'join' || p.get('localMp') === 'watch' || p.get('localMp') === 'browse' || p.get('localMpTest') === '1') {
            return true;
        }
        return typeof localStorage !== 'undefined' && localStorage.getItem('serenity.localMpTest') === '1';
    } catch {
        return false;
    }
}

export function resolveOnlineMultiplayerAvailability(connectionState = 'offline') {
    if (connectionState === 'connected' || connectionState === 'partial') {
        return {
            enabled: true,
            disabledLabel: '',
            title: '',
        };
    }

    if (connectionState === 'connecting') {
        return {
            enabled: false,
            disabledLabel: 'Connecting to Steam',
            title: 'Connecting to Steam',
        };
    }

    if (connectionState === 'offline') {
        return {
            enabled: false,
            disabledLabel: 'Steam offline',
            title: 'Steam is offline',
        };
    }

    return {
        enabled: false,
        disabledLabel: 'Steam required',
        title: 'Requires Steam connection',
    };
}

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
        // Wire pointer, keyboard, and gamepad through ONE activation path so all
        // three input methods launch the SAME focused mode. The cards are <div>s,
        // which never emit `click` on Enter/Space — so a keyboard-only user used to
        // fall through to the global start-modal handler, which launched the
        // DEFAULT mode regardless of the focused card (a WCAG 2.1.1 / 4.1.2 failure,
        // made worse by the card still playing a "confirmed" chime). Gamepad already
        // synthesises a click (gamepad-controller.js), so it keeps working unchanged.
        const bind = (el, mode, { guard } = {}) => {
            if (!el) return;

            // Expose the card as a real button to assistive tech, mirroring the
            // role/aria-label/tabindex pattern the other icon buttons already use.
            el.setAttribute('role', 'button');
            if (!el.getAttribute('aria-label')) {
                const title = el.querySelector('.mode-card-title')?.textContent?.trim();
                if (title) el.setAttribute('aria-label', title);
            }
            const desc = el.querySelector('.mode-card-desc');
            if (desc) {
                if (!desc.id) desc.id = `mode-desc-${mode}`;
                el.setAttribute('aria-describedby', desc.id);
            }
            const icon = el.querySelector('.mode-card-icon');
            if (icon) icon.setAttribute('aria-hidden', 'true');

            const activate = (event) => {
                if (typeof guard === 'function' && guard()) return;
                event?.preventDefault?.();
                this.selectModeAndStart(mode);
            };

            el.addEventListener('click', activate);
            el.addEventListener('keydown', (event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                // This card owns Enter/Space — stop the document-level start-modal
                // handler from also firing and launching the default mode.
                event.stopPropagation();
                activate(event);
            });
        };

        bind(this.singlePlayerBtn, GAME_MODES.SINGLE_PLAYER);
        bind(this.localMultiplayerBtn, GAME_MODES.LOCAL_MULTIPLAYER);
        bind(this.onlineMultiplayerBtn, GAME_MODES.ONLINE_MULTIPLAYER, {
            guard: () => this.isOnlineMultiplayerDisabled(),
        });
        bind(this.serenityBtn, GAME_MODES.SERENITY);
        bind(this.infinityBtn, GAME_MODES.INFINITY);
        bind(this.odysseyBtn, GAME_MODES.ODYSSEY);
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
            steamService.on(STEAM_EVENTS.READY, () => this.updateOnlineMultiplayerAvailability()),
            steamService.on(STEAM_EVENTS.INIT_FAILED, () => this.updateOnlineMultiplayerAvailability()),
            steamService.on(STEAM_EVENTS.CONNECTED, () => this.updateOnlineMultiplayerAvailability()),
            steamService.on(STEAM_EVENTS.DISCONNECTED, () => this.updateOnlineMultiplayerAvailability()),
            steamService.on(STEAM_EVENTS.RECONNECTED, () => this.updateOnlineMultiplayerAvailability()),
            steamService.on(STEAM_EVENTS.STATE_CHANGED, () => this.updateOnlineMultiplayerAvailability()),
            steamService.on(STEAM_EVENTS.CAPABILITIES_UPDATED, () => this.updateOnlineMultiplayerAvailability()),
        );
    }

    updateOnlineMultiplayerAvailability() {
        if (!this.onlineMultiplayerBtn) return;
        // Local 2-player mock testing bypasses the Steam-connection gate.
        if (isLocalMpTestMode()) {
            this.setOnlineMultiplayerAvailability({ enabled: true, disabledLabel: '', title: '' });
            return;
        }
        const connectionState = steamService?.getConnectionState?.() || 'offline';
        const availability = resolveOnlineMultiplayerAvailability(connectionState);
        this.setOnlineMultiplayerAvailability(availability);
    }

    setOnlineMultiplayerAvailability({ enabled, disabledLabel, title }) {
        if (!this.onlineMultiplayerBtn) return;
        this.onlineMultiplayerBtn.classList.toggle('steam-disabled', !enabled);
        this.onlineMultiplayerBtn.dataset.disabled = enabled ? 'false' : 'true';
        this.onlineMultiplayerBtn.dataset.disabledLabel = enabled ? '' : disabledLabel;
        this.onlineMultiplayerBtn.setAttribute('aria-disabled', String(!enabled));
        this.onlineMultiplayerBtn.setAttribute('tabindex', enabled ? '0' : '-1');
        this.onlineMultiplayerBtn.title = enabled ? '' : title;
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
