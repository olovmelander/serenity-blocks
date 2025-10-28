/**
 * Lobby Waiting Room
 * 
 * Players wait here after joining a lobby before the match starts
 * Shows all connected players, ready states, and host controls
*/

import { onMultiplayerEvent, MULTIPLAYER_EVENTS } from '../events/multiplayer-events.js';

export class LobbyWaitingRoom {
  constructor(ffaGameState, onMatchStart, onLeaveLobby = null) {
    this.gameState = ffaGameState;
    this.onMatchStart = onMatchStart;
    this.onLeaveLobby = onLeaveLobby;
    this.container = null;
    this.updateInterval = null;
    
    this.createUI();
  }
  
  /**
   * Create the waiting room UI
   */
  createUI() {
    this.container = document.createElement('div');
    this.container.id = 'lobby-waiting-room';
    this.container.className = 'lobby-waiting-room hidden';
    
    this.container.innerHTML = `
      <div class="waiting-room-overlay"></div>
      <div class="waiting-room-modal">
        <div class="waiting-room-header">
          <h2>🎮 Lobby: <span id="room-name">Loading...</span></h2>
          <button class="close-btn" id="leave-lobby-btn">Leave</button>
        </div>
        
        <div class="waiting-room-content">
          <!-- Match Info -->
          <div class="match-info-panel">
            <h3>Match Settings</h3>
            <div class="match-info-grid">
              <div class="info-item">
                <span class="info-label">Max Players</span>
                <span class="info-value" id="max-players-value">-</span>
              </div>
              <div class="info-item">
                <span class="info-label">Win Condition</span>
                <span class="info-value" id="win-condition-value">-</span>
              </div>
              <div class="info-item">
                <span class="info-label">Target</span>
                <span class="info-value" id="win-target-value">-</span>
              </div>
              <div class="info-item">
                <span class="info-label">Host</span>
                <span class="info-value" id="host-name-value">-</span>
              </div>
            </div>
          </div>
          
          <!-- Player List -->
          <div class="player-list-panel">
            <div class="player-list-header">
              <h3>Players (<span id="player-count">0</span>/<span id="max-players-count">8</span>)</h3>
              <div class="ready-legend">
                <span class="ready-indicator ready">●</span> Ready
                <span class="ready-indicator not-ready">●</span> Not Ready
              </div>
            </div>
            <div class="player-list" id="player-list">
              <!-- Players will be added here -->
            </div>
          </div>
          
          <!-- Chat Area (Future) -->
          <div class="chat-panel">
            <div class="chat-messages" id="chat-messages">
              <div class="system-message">
                Welcome to the lobby! Waiting for players to join...
              </div>
            </div>
          </div>
        </div>
        
        <!-- Ready/Start Controls -->
        <div class="waiting-room-footer">
          <div class="footer-left">
            <span class="waiting-indicator" id="waiting-text">
              Waiting for players...
            </span>
          </div>
          <div class="footer-right">
            <!-- Ready Button (for non-host players) -->
            <button 
              class="btn btn-ready" 
              id="ready-btn"
              style="display: none;"
            >
              Ready Up
            </button>
            
            <!-- Start Button (for host) -->
            <button 
              class="btn btn-primary btn-start" 
              id="start-match-btn"
              style="display: none;"
              disabled
            >
              🚀 Start Match
            </button>
          </div>
        </div>
      </div>
    `;
    
    document.body.appendChild(this.container);
    
    this.setupEventListeners();
  }
  
  /**
   * Setup event listeners
   */
  setupEventListeners() {
    // Leave button
    const leaveBtn = this.container.querySelector('#leave-lobby-btn');
    leaveBtn.addEventListener('click', (e) => {
      e.stopPropagation(); // Prevent global click handler from triggering
      this.leaveLobby();
    });
    
    // Ready button
    const readyBtn = this.container.querySelector('#ready-btn');
    readyBtn.addEventListener('click', (e) => {
      e.stopPropagation(); // Prevent global click handler from triggering
      this.toggleReady();
    });

    // Start button
    const startBtn = this.container.querySelector('#start-match-btn');
    startBtn.addEventListener('click', (e) => {
      e.stopPropagation(); // Prevent global click handler from triggering single-player start
      this.startMatch();
    });
  }
  
  /**
   * Show the waiting room
   */
  show() {
    if (!this.container) {
      console.error('❌ Waiting room container not created');
      return;
    }
    
    if (!this.gameState) {
      console.warn('⚠️ No game state set for waiting room');
    }
    
    console.log('📋 Showing waiting room...');
    this.container.classList.remove('hidden');
    
    // Update UI after a brief delay to ensure DOM is ready
    setTimeout(() => {
      this.updateUI();
    }, 50);
    
    // Update every second
    this.updateInterval = setInterval(() => this.updateUI(), 1000);
    
    // Listen for player list changes and update immediately
    this.playerListChangeHandler = () => {
      console.log('🔄 Player list changed, updating UI...');
      this.updateUI();
    };
    this.playerListChangeUnsub = onMultiplayerEvent(
      MULTIPLAYER_EVENTS.PLAYER_LIST_CHANGED,
      this.playerListChangeHandler
    );
    
    console.log('✅ Waiting room visible');
  }
  
  /**
   * Hide the waiting room
   */
  hide() {
    this.container.classList.add('hidden');
    
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
    
    // Remove event listener
    if (this.playerListChangeUnsub) {
      this.playerListChangeUnsub();
      this.playerListChangeUnsub = null;
      this.playerListChangeHandler = null;
    }
  }
  
  /**
   * Update UI with current game state
   */
  updateUI() {
    if (!this.gameState) {
      console.warn('⚠️ updateUI called but no gameState');
      return;
    }
    
    try {
      // Update match info
      this.updateMatchInfo();
      
      // Update player list
      this.updatePlayerList();
      
      // Update controls
      this.updateControls();
    } catch (err) {
      console.error('❌ Error updating waiting room UI:', err);
    }
  }
  
  /**
   * Update match info panel
   */
  updateMatchInfo() {
    const config = this.gameState.matchConfig;
    
    // Max players
    const maxPlayersValue = document.getElementById('max-players-value');
    const maxPlayersCount = document.getElementById('max-players-count');
    
    if (maxPlayersValue) maxPlayersValue.textContent = config.maxPlayers;
    if (maxPlayersCount) maxPlayersCount.textContent = config.maxPlayers;
    
    // Win condition
    const conditionText = this.getConditionText(config.endCondition);
    const winConditionValue = document.getElementById('win-condition-value');
    if (winConditionValue) winConditionValue.textContent = conditionText;
    
    // Target value
    let targetText = config.endConditionValue;
    if (config.endCondition === 'points') {
      targetText = `${config.endConditionValue}K`;
    } else if (config.endCondition === 'time') {
      targetText = `${config.endConditionValue} min`;
    } else if (config.endCondition === 'never') {
      targetText = 'N/A';
    }
    const winTargetValue = document.getElementById('win-target-value');
    if (winTargetValue) winTargetValue.textContent = targetText;
    
    // Host name
    const hostPlayer = Array.from(this.gameState.players.values())
      .find(p => p.steamId === this.gameState.network.hostSteamId);
    const hostNameValue = document.getElementById('host-name-value');
    if (hostNameValue) {
      hostNameValue.textContent = hostPlayer ? hostPlayer.name : 'Unknown';
    }
  }
  
  /**
   * Get condition text
   */
  getConditionText(condition) {
    const map = {
      frags: 'Frags',
      time: 'Time Limit',
      points: 'Score Target',
      lines: 'Lines Cleared',
      never: 'Never (Manual)'
    };
    return map[condition] || condition;
  }
  
  /**
   * Update player list
   */
  updatePlayerList() {
    const listEl = document.getElementById('player-list');
    const players = Array.from(this.gameState.players.values());
    
    console.log(`📊 [LOBBY] Updating player list: ${players.length} players`);
    players.forEach(p => console.log(`   - ${p.name} (${p.steamId}) - Color: ${p.color}`));
    
    // Update count
    document.getElementById('player-count').textContent = players.length;
    
    // Render players
    listEl.innerHTML = players.map(player => {
      const isHost = player.steamId === this.gameState.network.hostSteamId;
      const isLocal = player.steamId === this.gameState.localPlayerId;
      const isReady = player.isReady || isHost; // Host is always "ready"
      const playerColor = player.color || '#808080';
      
      return `
        <div class="player-item ${isReady ? 'ready' : ''} ${isLocal ? 'local' : ''}" style="--player-color: ${playerColor};">
          <div class="player-color-indicator"></div>
          <div class="player-info">
            <span class="player-name ${isHost ? 'host' : ''} ${isLocal ? 'local' : ''}">
              ${this.escapeHtml(player.name)}
            </span>
            <span class="player-status">
              ${isHost ? 'Match Host' : isLocal ? 'You' : 'Player'}
            </span>
          </div>
          <div class="player-ready-indicator ${isReady ? 'ready' : 'not-ready'}">
            ${isReady ? 'Ready' : 'Waiting'}
          </div>
        </div>
      `;
    }).join('');
  }
  
  /**
   * Update control buttons
   */
  updateControls() {
    const isHost = this.gameState.isHost;
    const players = Array.from(this.gameState.players.values());
    const readyCount = players.filter(p => p.isReady || p.steamId === this.gameState.network.hostSteamId).length;
    const minPlayers = 2; // Minimum 2 players to start
    
    const readyBtn = document.getElementById('ready-btn');
    const startBtn = document.getElementById('start-match-btn');
    const waitingText = document.getElementById('waiting-text');
    
    if (isHost) {
      // Show start button for host
      readyBtn.style.display = 'none';
      startBtn.style.display = 'block';
      
      // Enable start button if conditions met
      const canStart = players.length >= minPlayers && readyCount === players.length;
      startBtn.disabled = !canStart;
      
      if (canStart) {
        waitingText.textContent = '✅ All players ready!';
        waitingText.className = 'waiting-indicator ready';
      } else if (players.length < minPlayers) {
        waitingText.textContent = `Waiting for ${minPlayers - players.length} more player(s)...`;
        waitingText.className = 'waiting-indicator';
      } else {
        waitingText.textContent = `Waiting for ${players.length - readyCount} player(s) to ready up...`;
        waitingText.className = 'waiting-indicator';
      }
    } else {
      // Show ready button for non-host
      readyBtn.style.display = 'block';
      startBtn.style.display = 'none';
      
      const localPlayer = this.gameState.getLocalPlayer();
      if (localPlayer && localPlayer.isReady) {
        readyBtn.textContent = '✓ Ready';
        readyBtn.classList.add('ready');
        waitingText.textContent = 'Waiting for host to start...';
      } else {
        readyBtn.textContent = 'Ready Up';
        readyBtn.classList.remove('ready');
        waitingText.textContent = 'Click ready when you\'re set!';
      }
    }
  }
  
  /**
   * Toggle ready state
   */
  toggleReady() {
    const localPlayer = this.gameState.getLocalPlayer();
    if (!localPlayer) return;
    
    const newReadyState = !localPlayer.isReady;
    this.gameState.setReady(newReadyState);
    
    // Add chat message
    this.addChatMessage(`You are now ${newReadyState ? 'ready' : 'not ready'}`);
    
    // Update UI immediately
    this.updateUI();
  }
  
  /**
   * Start the match (host only)
   */
  startMatch() {
    if (!this.gameState.isHost) {
      console.warn('Only host can start match');
      return;
    }
    
    const players = Array.from(this.gameState.players.values());
    const readyCount = players.filter(p => p.isReady || p.steamId === this.gameState.network.hostSteamId).length;
    
    if (players.length < 2) {
      alert('Need at least 2 players to start');
      return;
    }
    
    if (readyCount < players.length) {
      alert('Not all players are ready');
      return;
    }
    
    console.log('🚀 Host starting match!');
    
    // Start the match
    this.gameState.startMatch();
    
    // Hide waiting room
    this.hide();
    
    // Call callback
    if (this.onMatchStart) {
      this.onMatchStart();
    }
  }
  
  /**
   * Leave the lobby
   */
  leaveLobby() {
    const confirmed = confirm('Are you sure you want to leave the lobby?');
    if (!confirmed) return;
    
    console.log('👋 Leaving lobby');
    
    // Cleanup
    if (this.gameState) {
      this.gameState.cleanup();
    }
    
    // Hide waiting room
    this.hide();
    
    // Call callback to return to lobby browser
    if (this.onLeaveLobby) {
      this.onLeaveLobby();
    }
  }
  
  /**
   * Add chat message
   */
  addChatMessage(message, isSystem = true) {
    const chatEl = document.getElementById('chat-messages');
    const msgClass = isSystem ? 'system-message' : 'player-message';
    
    const msgDiv = document.createElement('div');
    msgDiv.className = msgClass;
    msgDiv.textContent = message;
    
    chatEl.appendChild(msgDiv);
    chatEl.scrollTop = chatEl.scrollHeight;
  }
  
  /**
   * Escape HTML
   */
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
  
  /**
   * Destroy the waiting room
   */
  destroy() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }
    
    if (this.container) {
      this.container.remove();
    }
  }
}
