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
            this.gameState.chatHistory.forEach(msg => this.addMessage(msg, true));
        }
    }

    /**
     * Get the right panel chat input element
     */
    getRightPanelChatInput() {
        return document.getElementById('match-chat-input');
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
            if (!chatInput) return;

            const activeEl = document.activeElement;
            const isTypingInInput = activeEl && (
                activeEl.tagName === 'INPUT' ||
                activeEl.tagName === 'TEXTAREA' ||
                activeEl.isContentEditable
            );

            if (e.key === 'Enter') {
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
     * Add a message to the right panel chat
     * @param {Object|string} msg - Message object with playerName/message/steamId, or string for system messages
     * @param {boolean} silent - If true, don't play sound
     */
    addMessage(msg, silent = false) {
        this.messages.push(msg);
        if (this.messages.length > 50) this.messages.shift();

        const messagesContainer = this.getRightPanelMessages();
        if (!messagesContainer) return;

        const el = document.createElement('div');

        // Handle both object format and string format (for system messages)
        if (typeof msg === 'string') {
            // System message
            el.className = 'system-message';
            el.textContent = msg;
        } else {
            // Player message - get player color
            const playerColor = msg.color || this.getPlayerColor(msg.steamId) || '#a78bfa';
            el.className = 'player-message';
            el.innerHTML = `
                <span class="color-indicator" style="background: ${playerColor};"></span>
                <span class="author" style="color: ${playerColor};">${this.escapeHtml(msg.playerName)}:</span>
                <span class="text">${this.escapeHtml(msg.message)}</span>
            `;
        }

        messagesContainer.appendChild(el);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    /**
     * Escape HTML to prevent XSS
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
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
