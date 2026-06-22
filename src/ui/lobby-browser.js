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

        <div class="lobby-join-by-id" style="display:flex; gap:8px; margin:14px 0 4px;">
          <input type="text" id="join-by-id-input"
            placeholder="Paste a Lobby ID to join a friend's match"
            maxlength="32" inputmode="numeric" autocomplete="off" spellcheck="false"
            style="flex:1; min-width:0; padding:10px 12px; border-radius:8px; border:1px solid rgba(255,255,255,0.18); background:rgba(0,0,0,0.35); color:#fff; font-size:14px;" />
          <button class="btn btn-primary" id="join-by-id-btn">Join</button>
        </div>
        <div class="join-by-id-hint" style="font-size:12px; color:rgba(255,255,255,0.6); margin-bottom:6px;">
          💡 Ask the host for their <strong>Lobby ID</strong> (shown in their waiting room), or use <strong>Invite Friends</strong> / Steam → <em>Join Game</em>.
        </div>
        <div class="join-by-id-error" id="join-by-id-error" style="display:none; font-size:12px; color:#ff7676; margin-bottom:6px;"></div>

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
              <p>🔍 No public lobbies found</p>
              <p class="text-muted">Create a match, or join a friend with their <strong>Lobby ID</strong> above.</p>
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

        // Join-by-ID (room code) — the reliable cross-machine path that does not
        // depend on the public lobby list (which Steam region-filters and caps).
        const joinIdBtn = this.container.querySelector('#join-by-id-btn');
        const joinIdInput = this.container.querySelector('#join-by-id-input');
        if (joinIdBtn) {
            joinIdBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.joinById();
            });
        }
        if (joinIdInput) {
            joinIdInput.addEventListener('keydown', (e) => {
                // Keep keystrokes out of the global game hotkey handlers.
                e.stopPropagation();
                if (e.key === 'Enter') this.joinById();
            });
            joinIdInput.addEventListener('input', () => this.clearJoinError());
        }
    }

    /**
   * Join a lobby from the pasted Lobby ID (room code). Steam lobby IDs are
   * numeric, so we strip everything else to tolerate stray spaces/quotes.
   */
    joinById() {
        const input = this.container.querySelector('#join-by-id-input');
        const raw = (input?.value || '').trim();
        const id = raw.replace(/\D/g, '');

        if (!id) {
            this.showJoinError('Enter a Lobby ID to join (numbers only).');
            return;
        }

        this.clearJoinError();
        // Reuse the same join path as the lobby list (calls onJoinLobby + hides).
        this.joinLobby(id);
    }

    showJoinError(message) {
        const el = this.container.querySelector('#join-by-id-error');
        if (!el) return;
        el.textContent = message;
        el.style.display = 'block';
    }

    clearJoinError() {
        const el = this.container.querySelector('#join-by-id-error');
        if (el) el.style.display = 'none';
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
          <p>🔍 No public lobbies found</p>
          <p class="text-muted">Create a match, or join a friend with their <strong>Lobby ID</strong> above.</p>
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
