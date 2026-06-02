/**
 * Lobby Browser UI
 *
 * Displays available multiplayer lobbies and allows players to:
 * - Browse available matches
 * - Create new matches
 * - Join existing matches
 * - Configure match settings
 */

export class LobbyBrowser {
    constructor(steamNetworking, onJoinLobby, onCreateLobby, onCancel = null) {
        this.steam = steamNetworking;
        this.onJoinLobby = onJoinLobby;
        this.onCreateLobby = onCreateLobby;
        this.onCancel = onCancel;

        this.container = null;
        this.refreshInterval = null;
        this.lobbies = [];

        this.createUI();
    }

    /**
   * Create the lobby browser UI
   */
    createUI() {
    // Create container
        this.container = document.createElement('div');
        this.container.id = 'lobby-browser';
        this.container.className = 'lobby-browser hidden';

        this.container.innerHTML = `
      <div class="lobby-browser-overlay"></div>
      <div class="lobby-browser-modal">
        <div class="lobby-browser-header">
          <h2>🎮 Multiplayer Lobbies</h2>
          <button class="close-btn" id="close-lobby-browser">✕</button>
        </div>
        
        <div class="lobby-browser-controls">
          <button class="btn btn-primary" id="create-match-btn">
            ➕ Create New Match
          </button>
          <button class="btn btn-secondary" id="refresh-lobbies-btn">
            🔄 Refresh
          </button>
        </div>
        
        <div class="lobby-list-container">
          <div class="lobby-list-header">
            <span class="col-name">Match Name</span>
            <span class="col-players">Players</span>
            <span class="col-condition">Win Condition</span>
            <span class="col-status">Status</span>
            <span class="col-action">Action</span>
          </div>
          <div class="lobby-list" id="lobby-list">
            <div class="lobby-list-empty">
              <p>🔍 No lobbies found</p>
              <p class="text-muted">Create a new match to get started!</p>
            </div>
          </div>
        </div>
        
        <div class="lobby-browser-footer">
          <p class="text-muted">
            <span id="lobby-count">0</span> lobbies available
          </p>
        </div>
      </div>
    `;

        // Add to DOM
        document.body.appendChild(this.container);

        // Setup event listeners
        this.setupEventListeners();
    }

    /**
   * Setup event listeners
   */
    setupEventListeners() {
    // Close button
        const closeBtn = this.container.querySelector('#close-lobby-browser');
        closeBtn.addEventListener('click', () => this.cancel());

        // Overlay click to close
        const overlay = this.container.querySelector('.lobby-browser-overlay');
        overlay.addEventListener('click', () => this.cancel());

        // Create match button
        const createBtn = this.container.querySelector('#create-match-btn');
        createBtn.addEventListener('click', () => this.showCreateMatchModal());

        // Refresh button
        const refreshBtn = this.container.querySelector('#refresh-lobbies-btn');
        refreshBtn.addEventListener('click', () => this.refresh());
    }

    /**
   * Show the lobby browser
   */
    async show() {
        this.container.classList.remove('hidden');
        await this.refresh();

        // Auto-refresh every 5 seconds
        this.refreshInterval = setInterval(() => this.refresh(), 5000);
    }

    /**
   * Hide the lobby browser
   */
    hide() {
        this.container.classList.add('hidden');

        // Stop auto-refresh
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = null;
        }
    }

    /**
   * Cancel the lobby browser (hide and trigger cancel callback)
   */
    async cancel() {
        this.hide();

        if (this.onCancel) {
            console.log('[LobbyBrowser] Triggering cancel callback');
            await this.onCancel();
            console.log('[LobbyBrowser] Cancel callback completed');
        }
    }

    /**
   * Refresh lobby list
   */
    async refresh() {
        try {
            // Get lobbies from Steam
            this.lobbies = await this.steam.getLobbies();

            // Update UI
            this.renderLobbies();

            // Update count
            const countEl = this.container.querySelector('#lobby-count');
            countEl.textContent = this.lobbies.length;
        } catch (err) {
            console.error('Failed to refresh lobbies:', err);
        }
    }

    /**
   * Render lobby list
   */
    renderLobbies() {
        const listEl = this.container.querySelector('#lobby-list');

        if (this.lobbies.length === 0) {
            listEl.innerHTML = `
        <div class="lobby-list-empty">
          <p>🔍 No lobbies found</p>
          <p class="text-muted">Create a new match to get started!</p>
        </div>
      `;
            return;
        }

        listEl.innerHTML = this.lobbies.map((lobby) => {
            const max = lobby.maxPlayers || 8;
            const current = this.getPlayerCount(lobby);
            const status = this.getLobbyStatus(lobby);
            const condition = lobby.endCondition || 'frags';
            const pct = Math.min(100, Math.round((current / max) * 100));
            const joinable = this.canJoinLobby(lobby);
            const disabledLabel = status === 'playing' ? 'In Progress' : 'Full';

            return `
      <div class="lobby-item" data-lobby-id="${lobby.id}">
        <span class="col-name">
          <strong>${this.escapeHtml(lobby.name)}</strong>
          ${lobby.hostName ? `<span class="lobby-host">by ${this.escapeHtml(lobby.hostName)}</span>` : ''}
        </span>
        <span class="col-players">
          <span class="player-count">${current}/${max}</span>
          <span class="capacity-bar"><span class="capacity-fill" style="width:${pct}%"></span></span>
        </span>
        <span class="col-condition">
          <span class="badge badge-${condition}">${condition}</span>
        </span>
        <span class="col-status">
          <span class="status-badge status-${status}">${this.getStatusText(status)}</span>
        </span>
        <span class="col-action">
          ${joinable
        ? `<button class="btn btn-sm btn-join" data-lobby-id="${lobby.id}">Join</button>`
        : `<button class="btn btn-sm btn-disabled" disabled>${disabledLabel}</button>`
}
        </span>
      </div>
    `;
        }).join('');

        // Add join button listeners
        listEl.querySelectorAll('.btn-join').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                const { lobbyId } = e.target.dataset;
                this.joinLobby(lobbyId);
            });
        });
    }

    /**
   * Resolve the current player count from whichever field the source provides.
   * Mock lobbies expose `players`; live game state uses `playerCount`.
   */
    getPlayerCount(lobby) {
        return lobby.players ?? lobby.playerCount ?? lobby.currentPlayers ?? 0;
    }

    /**
   * Resolve a lobby's status, deriving it from capacity when not supplied.
   */
    getLobbyStatus(lobby) {
        if (lobby.status) return lobby.status;
        const max = lobby.maxPlayers || 8;
        return this.getPlayerCount(lobby) >= max ? 'full' : 'open';
    }

    /**
   * Check if player can join lobby
   */
    canJoinLobby(lobby) {
        const status = this.getLobbyStatus(lobby);
        if (status === 'playing' || status === 'finished') return false;
        if (this.getPlayerCount(lobby) >= (lobby.maxPlayers || 8)) return false;
        return true;
    }

    /**
   * Get status text
   */
    getStatusText(status) {
        const statusMap = {
            open: 'Open',
            waiting: 'Open',
            full: 'Full',
            playing: 'In Progress',
            finished: 'Finished',
        };
        return statusMap[status] || 'Open';
    }

    /**
   * Join a lobby
   */
    async joinLobby(lobbyId) {
        try {
            console.log(`🚀 Joining lobby: ${lobbyId}`);

            if (this.onJoinLobby) {
                await this.onJoinLobby(lobbyId);
            }

            this.hide();
        } catch (err) {
            console.error('Failed to join lobby:', err);
            alert(`Failed to join lobby: ${err.message}`);
        }
    }

    /**
   * Show create match modal
   */
    showCreateMatchModal() {
    // Hide lobby browser temporarily
        this.hide();

        // Show match config modal
        if (this.onCreateLobby) {
            this.onCreateLobby();
        }
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
   * Destroy the lobby browser
   */
    destroy() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
        }

        if (this.container) {
            this.container.remove();
        }
    }
}
