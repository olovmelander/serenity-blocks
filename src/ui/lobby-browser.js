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
  constructor(steamNetworking, onJoinLobby, onCreateLobby) {
    this.steam = steamNetworking;
    this.onJoinLobby = onJoinLobby;
    this.onCreateLobby = onCreateLobby;
    
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
    closeBtn.addEventListener('click', () => this.hide());
    
    // Overlay click to close
    const overlay = this.container.querySelector('.lobby-browser-overlay');
    overlay.addEventListener('click', () => this.hide());
    
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
    
    listEl.innerHTML = this.lobbies.map((lobby, index) => `
      <div class="lobby-item" data-lobby-id="${lobby.id}">
        <span class="col-name">
          <strong>${this.escapeHtml(lobby.name)}</strong>
        </span>
        <span class="col-players">
          <span class="player-count">${lobby.currentPlayers}/${lobby.maxPlayers}</span>
        </span>
        <span class="col-condition">
          <span class="badge badge-${lobby.endCondition || 'frags'}">
            ${lobby.endCondition || 'frags'}
          </span>
        </span>
        <span class="col-status">
          <span class="status-badge status-${lobby.status || 'waiting'}">
            ${this.getStatusText(lobby.status)}
          </span>
        </span>
        <span class="col-action">
          ${this.canJoinLobby(lobby) 
            ? `<button class="btn btn-sm btn-join" data-lobby-id="${lobby.id}">Join</button>`
            : `<button class="btn btn-sm btn-disabled" disabled>Full</button>`
          }
        </span>
      </div>
    `).join('');
    
    // Add join button listeners
    listEl.querySelectorAll('.btn-join').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const lobbyId = e.target.dataset.lobbyId;
        this.joinLobby(lobbyId);
      });
    });
  }
  
  /**
   * Check if player can join lobby
   */
  canJoinLobby(lobby) {
    if (lobby.status === 'playing') return false;
    if (lobby.currentPlayers >= lobby.maxPlayers) return false;
    return true;
  }
  
  /**
   * Get status text
   */
  getStatusText(status) {
    const statusMap = {
      waiting: 'Waiting',
      playing: 'In Progress',
      finished: 'Finished'
    };
    return statusMap[status] || 'Unknown';
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

