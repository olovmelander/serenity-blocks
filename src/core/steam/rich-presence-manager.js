/**
 * RichPresenceManager - Automatic Steam Rich Presence updates
 *
 * Automatically updates Steam Rich Presence based on:
 * - Current game mode
 * - Game state (level, chapter, player count, position)
 * - Mode transitions
 *
 * Respects update frequency guidelines to avoid spamming Steam.
 */

import steamService from './steam-service.js';
import { GAME_MODES } from '../constants.js';

// Rich Presence string templates per mode
const PRESENCE_TEMPLATES = {
    menu: 'In Menus',
    [GAME_MODES.SINGLE_PLAYER]: (data) => `Single Player - Level ${data.level || 1}`,
    [GAME_MODES.ODYSSEY]: (data) => {
        if (data.chapter && data.levelName) {
            return `Odyssey - ${data.chapter}: ${data.levelName}`;
        }
        return `Odyssey Mode - Chapter ${data.chapter || 1}`;
    },
    [GAME_MODES.INFINITY]: (data) => `Infinity Mode - Level ${data.level || 1}`,
    [GAME_MODES.SERENITY]: () => 'Serenity Mode - Relaxing',
    [GAME_MODES.LOCAL_MULTIPLAYER]: (data) => `Local Multiplayer - ${data.playerCount || 2} Players`,
    [GAME_MODES.ONLINE_MULTIPLAYER]: (data) => {
        if (data.inMatch) {
            const position = data.position || 1;
            return `FFA Match - ${ordinal(position)} Place`;
        }
        if (data.inLobby) {
            return `FFA Lobby (${data.playerCount || 1}/${data.maxPlayers || 8}) - Waiting`;
        }
        return 'Online Multiplayer';
    },
};

// Minimum update intervals (ms) to avoid spamming Steam
const UPDATE_INTERVALS = {
    menu: 0, // Instant on menu enter
    [GAME_MODES.SINGLE_PLAYER]: 30000, // Every 30s or on level up
    [GAME_MODES.ODYSSEY]: 0, // Instant on level start
    [GAME_MODES.INFINITY]: 15000, // Every 15s (more dynamic mode)
    [GAME_MODES.SERENITY]: 0, // Instant, rarely changes
    [GAME_MODES.LOCAL_MULTIPLAYER]: 0, // Instant on start
    [GAME_MODES.ONLINE_MULTIPLAYER]: 5000, // More frequent for competitive
};

/**
 * Convert number to ordinal string (1st, 2nd, 3rd, etc.)
 */
function ordinal(n) {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/**
 * RichPresenceManager Singleton
 */
class RichPresenceManager {
    static instance = null;

    constructor() {
        this.currentMode = null;
        this.currentData = {};
        this.lastUpdateTime = 0;
        this.lastPresenceString = null;
        this.updateTimer = null;
        this.gameModeManager = null;
        this.unsubscribers = [];
    }

    /**
     * Get singleton instance
     */
    static getInstance() {
        if (!RichPresenceManager.instance) {
            RichPresenceManager.instance = new RichPresenceManager();
        }
        return RichPresenceManager.instance;
    }

    /**
     * Initialize with GameModeManager to auto-subscribe to mode changes
     * @param {GameModeManager} gameModeManager
     */
    initialize(gameModeManager) {
        if (this.gameModeManager) {
            console.warn('[RichPresenceManager] Already initialized');
            return;
        }

        this.gameModeManager = gameModeManager;

        // Subscribe to mode lifecycle events
        this.unsubscribers.push(
            gameModeManager.on('modeActivated', ({ modeId }) => {
                this.setMode(modeId);
            }),
            gameModeManager.on('modeStarted', ({ modeId }) => {
                this.setMode(modeId, { started: true });
            }),
            gameModeManager.on('modeStopped', () => {
                this.setMode('menu');
            }),
            gameModeManager.on('modeDeactivated', () => {
                this.setMode('menu');
            }),
        );

        // Set initial presence
        this.setMode('menu');

        // Listen for game state events (dispatched by game modes)
        this._setupGameEventListeners();

        console.log('[RichPresenceManager] Initialized with GameModeManager');
    }

    /**
     * Setup listeners for game state events from game modes
     * Game modes can dispatch these events to update Rich Presence
     * @private
     */
    _setupGameEventListeners() {
        // Level change event (Single Player, Infinity)
        this._levelChangeHandler = (e) => {
            const { level } = e.detail || {};
            if (level !== undefined) {
                this.setLevel(level);
            }
        };
        window.addEventListener('game:levelChange', this._levelChangeHandler);

        // Odyssey chapter/level change
        this._odysseyProgressHandler = (e) => {
            const { chapter, levelName } = e.detail || {};
            if (chapter !== undefined) {
                this.setChapter(chapter, levelName);
            }
        };
        window.addEventListener('game:odysseyProgress', this._odysseyProgressHandler);

        // FFA lobby status
        this._lobbyStatusHandler = (e) => {
            const { playerCount, maxPlayers } = e.detail || {};
            if (playerCount !== undefined) {
                this.setLobbyStatus(playerCount, maxPlayers);
            }
        };
        window.addEventListener('game:lobbyStatus', this._lobbyStatusHandler);

        // FFA match position update
        this._matchPositionHandler = (e) => {
            const { position, playerCount } = e.detail || {};
            if (position !== undefined) {
                this.setMatchStatus(position, playerCount);
            }
        };
        window.addEventListener('game:matchPosition', this._matchPositionHandler);

        // Local multiplayer player count
        this._localPlayersHandler = (e) => {
            const { playerCount } = e.detail || {};
            if (playerCount !== undefined) {
                this.setLocalPlayers(playerCount);
            }
        };
        window.addEventListener('game:localPlayers', this._localPlayersHandler);
    }

    /**
     * Set current game mode and update presence
     * @param {string} modeId - Game mode ID or 'menu'
     * @param {Object} data - Additional data (level, chapter, etc.)
     */
    setMode(modeId, data = {}) {
        this.currentMode = modeId;
        this.currentData = { ...data };
        this._scheduleUpdate(true); // Force immediate update on mode change
    }

    /**
     * Update presence data without changing mode
     * @param {Object} data - Data to merge with current
     */
    updateData(data) {
        this.currentData = { ...this.currentData, ...data };
        this._scheduleUpdate();
    }

    /**
     * Convenience methods for common updates
     */
    setLevel(level) {
        this.updateData({ level });
    }

    setChapter(chapter, levelName = null) {
        this.updateData({ chapter, levelName });
    }

    setLobbyStatus(playerCount, maxPlayers, inLobby = true) {
        this.updateData({
            playerCount, maxPlayers, inLobby, inMatch: false,
        });
    }

    setMatchStatus(position, playerCount) {
        this.updateData({
            position, playerCount, inMatch: true, inLobby: false,
        });
    }

    setLocalPlayers(playerCount) {
        this.updateData({ playerCount });
    }

    /**
     * Schedule a presence update (respects rate limits)
     * @param {boolean} force - Bypass rate limiting
     */
    _scheduleUpdate(force = false) {
        // Clear any pending update
        if (this.updateTimer) {
            clearTimeout(this.updateTimer);
            this.updateTimer = null;
        }

        const now = Date.now();
        const minInterval = UPDATE_INTERVALS[this.currentMode] || 0;
        const timeSinceLastUpdate = now - this.lastUpdateTime;

        if (force || timeSinceLastUpdate >= minInterval) {
            // Update immediately
            this._doUpdate();
        } else {
            // Schedule for later
            const delay = minInterval - timeSinceLastUpdate;
            this.updateTimer = setTimeout(() => {
                this._doUpdate();
            }, delay);
        }
    }

    /**
     * Actually perform the Steam Rich Presence update
     */
    async _doUpdate() {
        const presenceString = this._buildPresenceString();

        // Don't update if string hasn't changed
        if (presenceString === this.lastPresenceString) {
            return;
        }

        const success = await steamService.setRichPresence(presenceString);

        if (success) {
            this.lastPresenceString = presenceString;
            this.lastUpdateTime = Date.now();
            console.log(`[RichPresenceManager] Updated: "${presenceString}"`);
        }
    }

    /**
     * Build the presence string for current mode + data
     */
    _buildPresenceString() {
        const template = PRESENCE_TEMPLATES[this.currentMode];

        if (!template) {
            return PRESENCE_TEMPLATES.menu;
        }

        if (typeof template === 'function') {
            return template(this.currentData);
        }

        return template;
    }

    /**
     * Clear presence (on shutdown)
     */
    async clear() {
        if (this.updateTimer) {
            clearTimeout(this.updateTimer);
            this.updateTimer = null;
        }

        await steamService.clearRichPresence();
        this.lastPresenceString = null;
        console.log('[RichPresenceManager] Cleared');
    }

    /**
     * Cleanup subscriptions
     */
    destroy() {
        this.clear();
        this.unsubscribers.forEach((unsub) => unsub());
        this.unsubscribers = [];
        this.gameModeManager = null;

        // Remove game event listeners
        if (this._levelChangeHandler) {
            window.removeEventListener('game:levelChange', this._levelChangeHandler);
        }
        if (this._odysseyProgressHandler) {
            window.removeEventListener('game:odysseyProgress', this._odysseyProgressHandler);
        }
        if (this._lobbyStatusHandler) {
            window.removeEventListener('game:lobbyStatus', this._lobbyStatusHandler);
        }
        if (this._matchPositionHandler) {
            window.removeEventListener('game:matchPosition', this._matchPositionHandler);
        }
        if (this._localPlayersHandler) {
            window.removeEventListener('game:localPlayers', this._localPlayersHandler);
        }

        console.log('[RichPresenceManager] Destroyed');
    }
}

// Export singleton
export const richPresenceManager = RichPresenceManager.getInstance();
export { RichPresenceManager };
export default richPresenceManager;
