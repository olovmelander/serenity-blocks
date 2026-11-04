import { menuCoversGame } from './sheet-input.js';
import { appendChatMessage } from './chat-moderation.js';

export class InGameChat {
    constructor(gameState) {
        this.gameState = gameState;
        this.network = gameState.network;
        this.messages = [];
        this.isVisible = false;
        this._keydownHandler = null;

        this.setupEventListeners();

        // Restore history to the right panel chat
        if (this.gameState.chatHistory) {
            this.gameState.chatHistory.forEach((msg) => this.addMessage(msg, true));
        }
    }

    /**
     * Get the right panel chat input element
     */
    getRightPanelChatInput() {
        return document.getElementById('chat-input');
    }

    /**
     * Get the right panel chat messages container
     */
    getRightPanelMessages() {
        return document.querySelector('.online-chat .chat-messages');
    }

    setupEventListeners() {
        // Focus right panel chat on Enter key
        this._keydownHandler = (e) => {
            const chatInput = this.getRightPanelChatInput();

            // Only handle if chat input exists and we're not already typing in an input
            if (!chatInput || !chatInput.getClientRects?.().length) return;

            const activeEl = document.activeElement;
            const isTypingInInput = activeEl && (
                activeEl.tagName === 'INPUT'
                || activeEl.tagName === 'TEXTAREA'
                || activeEl.isContentEditable
            );

            if (e.key === 'Enter') {
                // A focused button (results, lobby) or a menu over the match keeps its Enter.
                if (e.defaultPrevented || menuCoversGame()
                    || activeEl?.closest?.('button, a[href], [role="button"], select, summary')) return;
                if (isTypingInInput && activeEl === chatInput) {
                    // Already in chat input, let the existing send handler work
                    return;
                } else if (!isTypingInInput) {
                    // Focus the right panel chat input
                    e.preventDefault();
                    chatInput.focus();
                    this.isVisible = true;
                }
            }

            if (e.key === 'Escape' && this.isVisible) {
                chatInput.blur();
                this.isVisible = false;
            }
        };

        document.addEventListener('keydown', this._keydownHandler);
    }

    /**
     * Get a player's color from the game state
     * @param {string} steamId - The player's Steam ID
     * @returns {string|null} The player's color hex code or null
     */
    getPlayerColor(steamId) {
        if (!steamId || !this.gameState?.players) return null;
        const player = this.gameState.players.get(steamId);
        return player?.color || null;
    }

    /**
     * Add a message to the right panel chat, if this player is shown it (chat-moderation.js:
     * chat on, author not muted).
     * @param {Object|string} msg - Message object with playerName/message/steamId, or string for system messages
     * @param {boolean} silent - If true, don't play sound
     */
    addMessage(msg, silent = false) {
        this.messages.push(msg);
        if (this.messages.length > 50) this.messages.shift();

        appendChatMessage(this.getRightPanelMessages(), msg, {
            localPlayerId: this.gameState?.localPlayerId,
            colorOf: (steamId) => this.getPlayerColor(steamId),
        });
    }

    /**
     * Cleanup event listeners
     */
    destroy() {
        if (this._keydownHandler) {
            document.removeEventListener('keydown', this._keydownHandler);
            this._keydownHandler = null;
        }
    }
}
