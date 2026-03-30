/**
 * OnlineChat - Chat component for online multiplayer
 *
 * Handles sending and receiving chat messages
 */
export class OnlineChat {
    constructor(container, onSend) {
        this.container = container;
        this.onSend = onSend;
        this.messagesContainer = null;
        this.inputEl = null;
        this.sendBtn = null;
        this.messages = [];
        this.maxMessages = 50;

        this._initializeDOM();
        this._setupEventListeners();
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
            this.inputEl.onkeypress = (e) => {
                if (e.key === 'Enter') {
                    this._handleSend();
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
        if (!text) return;

        if (this.onSend) {
            this.onSend(text);
        }

        this.inputEl.value = '';
    }

    /**
     * Add a received message
     * @param {Object} message - { author: string, text: string, isSystem?: boolean, color?: string }
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
        this._scrollToBottom();
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
     * Render the chat messages
     */
    render() {
        if (!this.messagesContainer) return;

        const html = this.messages.map((msg) => {
            if (msg.isSystem) {
                return `
                    <div class="system-message">
                        ${this._escapeHtml(msg.text)}
                    </div>
                `;
            }

            const nameColor = msg.color || '#a78bfa';
            return `
                <div class="player-message">
                    <span class="color-indicator" style="background:${nameColor};"></span>
                    <span class="author" style="color:${nameColor}">${this._escapeHtml(msg.author)}:</span>
                    <span class="text">${this._escapeHtml(msg.text)}</span>
                </div>
            `;
        }).join('');

        this.messagesContainer.innerHTML = html;
    }

    /**
     * Scroll chat to bottom
     */
    _scrollToBottom() {
        if (this.messagesContainer) {
            this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
        }
    }

    /**
     * Escape HTML
     */
    _escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text || '';
        return div.innerHTML;
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
        this.clear();
        if (this.sendBtn) this.sendBtn.onclick = null;
        if (this.inputEl) this.inputEl.onkeypress = null;
    }
}
