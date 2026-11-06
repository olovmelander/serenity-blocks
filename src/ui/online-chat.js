import {
    chatModerationNote, isChatOn, onChatModerationChange, renderChatLog,
} from './chat-moderation.js';

/**
 * OnlineChat - Chat component for online multiplayer
 *
 * Handles sending and receiving chat messages. What this player is shown (chat on or off,
 * muted players) is chat-moderation.js's; a mute or chat turned off redraws the log.
 */
export class OnlineChat {
    /**
     * @param {HTMLElement | null} container
     * @param {(text: string) => void} onSend
     * @param {{ localPlayerId?: string | null, colorOf?: (steamId: string) => (string | null | undefined) }} [options]
     */
    constructor(container, onSend, { localPlayerId = null, colorOf } = {}) {
        this.container = container;
        this.onSend = onSend;
        this.localPlayerId = localPlayerId;
        this.colorOf = colorOf;
        this.messagesContainer = null;
        this.inputEl = null;
        this.sendBtn = null;
        this.messages = [];
        this.maxMessages = 50;

        this._initializeDOM();
        this._setupEventListeners();
        this._moderationUnsub = onChatModerationChange((change) => {
            const note = chatModerationNote(change);
            if (note) this.addSystemMessage(note);
            else this.render();
        });
    }

    /**
     * Initialize DOM references
     */
    _initializeDOM() {
        if (!this.container) return;

        this.messagesContainer = document.getElementById('chat-messages');
        this.inputEl = document.getElementById('chat-input');
        this.sendBtn = document.getElementById('chat-send');
    }

    /**
     * Set up event listeners
     */
    _setupEventListeners() {
        if (this.sendBtn) {
            this.sendBtn.onclick = () => this._handleSend();
        }

        if (this.inputEl) {
            // Keys typed here are chat, not gameplay: keep them away from the global
            // game-input handlers (same isolation as the lobby and results chats).
            // Enter sends and hands the keyboard back to the game; Escape just leaves.
            this.inputEl.onkeydown = (e) => {
                e.stopPropagation();
                // Enter confirms and Escape cancels an IME candidate. Neither
                // should send the unfinished message or move focus out of chat.
                if (e.isComposing || e.keyCode === 229) return;
                if (e.key === 'Enter') {
                    e.preventDefault();
                    this._handleSend();
                    this.inputEl.blur();
                } else if (e.key === 'Escape') {
                    this.inputEl.blur();
                }
            };
        }
    }

    /**
     * Handle sending a message
     */
    _handleSend() {
        if (!this.inputEl) return;

        const text = this.inputEl.value.trim();
        if (!text || !isChatOn()) return;

        if (this.onSend) {
            this.onSend(text);
        }

        this.inputEl.value = '';
    }

    /**
     * Add a received message
     * @param {Object} message - { author: string, text: string, steamId?: string, isSystem?: boolean, color?: string }
     */
    addMessage(message) {
        this.messages.push({
            ...message,
            timestamp: Date.now(),
        });

        // Limit messages
        if (this.messages.length > this.maxMessages) {
            this.messages.shift();
        }

        this.render();
    }

    /**
     * Add a system message
     */
    addSystemMessage(text) {
        this.addMessage({
            author: 'System',
            text,
            isSystem: true,
        });
    }

    /**
     * Render the chat messages (renderChatLog leaves out what this player is not shown)
     */
    render() {
        renderChatLog(this.messagesContainer, this.messages, {
            localPlayerId: this.localPlayerId,
            colorOf: this.colorOf,
        });
    }

    /**
     * Focus the input
     */
    focus() {
        if (this.inputEl) {
            this.inputEl.focus();
        }
    }

    /**
     * Clear chat
     */
    clear() {
        this.messages = [];
        if (this.messagesContainer) {
            this.messagesContainer.innerHTML = '';
        }
    }

    /**
     * Clean up
     */
    destroy() {
        this._moderationUnsub?.();
        this._moderationUnsub = null;
        this.clear();
        if (this.sendBtn) this.sendBtn.onclick = null;
        if (this.inputEl) this.inputEl.onkeydown = null;
    }
}
