export class InGameChat {
    constructor(gameState) {
        this.gameState = gameState;
        this.network = gameState.network;
        this.messages = [];
        this.isVisible = false;

        // Dom Elements
        this.container = null;
        this.input = null;
        this.messageList = null;

        this.initUI();
        this.setupEventListeners();

        // Restore history
        if (this.gameState.chatHistory) {
            this.gameState.chatHistory.forEach(msg => this.addMessage(msg, true));
        }
    }

    initUI() {
        this.container = document.createElement('div');
        this.container.id = 'ingame-chat';
        this.container.className = 'ingame-chat hidden';

        // Styles are likely global or injected, but we structure here
        this.container.innerHTML = `
            <div id="ingame-chat-messages" class="chat-messages"></div>
            <input id="ingame-chat-input" type="text" placeholder="Press Enter to chat..." maxlength="100" />
        `;

        document.body.appendChild(this.container);

        this.messageList = this.container.querySelector('#ingame-chat-messages');
        this.input = this.container.querySelector('#ingame-chat-input');
    }

    setupEventListeners() {
        // Toggle chat visibility on Enter
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                if (this.isVisible && document.activeElement === this.input) {
                    this.sendMessage();
                } else {
                    this.show();
                    e.preventDefault(); // Prevent default if game uses Enter
                }
            }

            if (e.key === 'Escape' && this.isVisible) {
                this.hide();
            }
        });
    }

    show() {
        this.isVisible = true;
        this.container.classList.remove('hidden');
        this.input.focus();
        // Pause game input handling if necessary?
    }

    hide() {
        this.isVisible = false;
        this.container.classList.add('hidden');
        this.input.blur();
    }

    sendMessage() {
        const text = this.input.value.trim();
        if (text) {
            // Send to network
            this.network.sendP2PMessage(this.network.hostSteamId, 'game:chat', {
                message: text,
                playerName: this.network.playerName,
                steamId: this.gameState.localPlayerId,
                timestamp: Date.now(),
            });

            // If we are host, broadcast immediately
            if (this.gameState.isHost) {
                // The game state chat handler will catch this message as if it came from network loop?
                // No, sendP2PMessage sends to peer. If hostSteamId == self, we need to handle local.
                if (this.network.hostSteamId === this.gameState.localPlayerId) {
                    // We are host transmitting to ourselves?
                    // Usually network lib handles loopback or we need manual trigger.
                    // Assuming manual trigger here for now.
                    // Actually, let's rely on game-state to re-broadcast.
                }
            }
        }
        this.input.value = '';
        this.hide();
    }

    addMessage(msg, silent = false) {
        this.messages.push(msg);
        if (this.messages.length > 50) this.messages.shift();

        const el = document.createElement('div');
        el.className = 'chat-message';
        el.innerHTML = `<span class="author">${msg.playerName}:</span> <span class="text">${msg.message}</span>`;
        this.messageList.appendChild(el);
        this.messageList.scrollTop = this.messageList.scrollHeight;

        // Auto-show for a few seconds if hidden?
        if (!this.isVisible && !silent) {
            this.container.classList.remove('hidden');
            setTimeout(() => {
                if (!this.isVisible && document.activeElement !== this.input) {
                    this.container.classList.add('hidden');
                }
            }, 5000);
        }
    }
}
