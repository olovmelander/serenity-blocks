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
  /**
 * Create the waiting room UI
 */
  createUI() {
    this.container = document.createElement('div');
    this.container.id = 'lobby-waiting-room';
    // Use the same grid layout class as the game
    this.container.className = 'online-game-area lobby-mode hidden';

    this.container.innerHTML = `
      <!-- LEFT PANEL: Lobby Info & Settings -->
      <div class="opponents-panel lobby-left-panel">
        <div class="watch-controls">
            <div class="watch-controls-row">
                <span style="font-weight: 700; color: #fff;">LOBBY</span>
                <button class="close-btn" id="leave-lobby-btn" style="width: 32px; height: 32px; font-size: 16px;">✕</button>
            </div>
            <div class="lobby-header-info">
                <h2 id="room-name" style="font-size: 18px; margin: 10px 0; color: #a78bfa;">Loading...</h2>
            </div>
        </div>

        <div class="match-info-panel" style="flex: 1; overflow-y: auto;">
            <h3>Match Settings</h3>
            <div class="match-info-grid" style="display: flex; flex-direction: column; gap: 10px;">
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
        
        <!-- Controls Area (Bottom Left) -->
        <div class="lobby-controls" style="margin-top: auto; padding-top: 20px;">
             <!-- Invite Link / Room Code could go here -->
             <div class="room-code-display" style="background: rgba(0,0,0,0.3); padding: 10px; border-radius: 8px; text-align: center;">
                <div style="font-size: 10px; color: #a0aec0; text-transform: uppercase;">Lobby ID</div>
                <div style="font-size: 14px; color: #fff; font-family: monospace; letter-spacing: 1px;" id="lobby-id-display">Connecting...</div>
             </div>
        </div>
      </div>

      <!-- CENTER PANEL: Player Grid -->
      <div class="main-board-panel lobby-center-panel">
        <div class="lobby-center-header">
             <h3 style="color: #fff; font-size: 20px; display: flex; align-items: center; gap: 10px;">
                PLAYERS <span class="player-count-badge" id="player-count-badge"><span id="player-count">0</span>/<span id="max-players-count">8</span></span>
             </h3>
             <div class="ready-legend">
                <span class="ready-indicator ready">●</span> Ready
                <span class="ready-indicator not-ready">●</span> Not Ready
             </div>
        </div>
        
        <div class="lobby-player-grid" id="player-list">
             <!-- Big player cards go here -->
        </div>
        
        <!-- CENTER FOOTER: Main Actions -->
        <div class="lobby-center-footer">
             <span class="waiting-indicator" id="waiting-text">Waiting for players...</span>
             
             <div class="lobby-action-buttons">
                <!-- Ready Button -->
                <button class="btn btn-ready" id="ready-btn" style="display: none;">
                  READY UP
                </button>
                
                <!-- Start Button -->
                <button class="btn btn-primary btn-start" id="start-match-btn" style="display: none;" disabled>
                  🚀 START MATCH
                </button>
             </div>
        </div>
      </div>
      
      <!-- RIGHT PANEL: Chat & Activity -->
      <div class="right-panel">
          <!-- Hidden Scoreboard (Empty for lobby) or maybe Activity Log -->
          <div class="online-kill-feed" id="lobby-activity-log" style="flex: 1; min-height: 200px;">
             <div class="kill-feed-header">Activity Log</div>
             <div class="kill-feed-list" id="activity-log-list"></div>
          </div>
          
          <!-- Chat Area (Bottom Right - Same as In-Game) -->
          <div class="online-chat">
            <div class="chat-messages" id="chat-messages">
              <div class="system-message">Welcome to the lobby!</div>
            </div>
            <div class="chat-input-row" style="display: flex; gap: 8px; padding: 10px; background: rgba(0,0,0,0.3);">
                <input type="text" id="lobby-chat-input" placeholder="Chat..." maxlength="100" style="flex: 1; background: rgba(255,255,255,0.1); border: 1px solid rgba(139,92,246,0.3); color: white; padding: 8px; border-radius: 4px;">
                <button id="lobby-chat-send" style="background: #8b5cf6; border: none; color: white; padding: 0 15px; border-radius: 4px; cursor: pointer; font-weight: bold;">SEND</button>
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

    // Chat integration
    // Listen for incoming messages
    this.chatHandler = (detail) => {
      this.addChatMessage(`${detail.playerName}: ${detail.message}`, false);
    };
    onMultiplayerEvent(MULTIPLAYER_EVENTS.CHAT_MESSAGE, this.chatHandler);

    // Chat input
    const chatInput = this.container.querySelector('#lobby-chat-input');
    const chatSend = this.container.querySelector('#lobby-chat-send');

    const sendChat = () => {
      const text = chatInput.value.trim();
      if (text && this.gameState) {
        this.gameState.network.sendP2PMessage(this.gameState.network.hostSteamId, 'game:chat', {
          message: text,
          playerName: this.gameState.network.playerName,
          steamId: this.gameState.localPlayerId,
          timestamp: Date.now()
        });

        // Add to local history/UI
        const msgData = {
          message: text,
          playerName: this.gameState.network.playerName,
          steamId: this.gameState.localPlayerId,
          timestamp: Date.now()
        };
        if (this.gameState.chatHistory) this.gameState.chatHistory.push(msgData);
        this.addChatMessage(`You: ${text}`, false);
        chatInput.value = '';
      }
    };

    if (chatSend) chatSend.addEventListener('click', sendChat);
    if (chatInput) chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') sendChat();
      e.stopPropagation();
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

      // Load chat history
      const chatEl = this.container.querySelector('#chat-messages');
      if (chatEl && this.gameState && this.gameState.chatHistory) {
        // Clear current (except welcome message?) - keeping welcome message at top
        // Actually, if we just append, we might duplicate.
        // Let's clear and re-render to be safe.
        chatEl.innerHTML = `
              <div class="system-message">
                Welcome to the lobby!
              </div>
          `;

        this.gameState.chatHistory.forEach(msg => {
          // Convert history format to text
          const isSystem = !msg.playerName; // If we store system messages without name
          const text = isSystem ? msg.text : `${msg.playerName}: ${msg.message}`;
          this.addChatMessage(text, isSystem);
        });
      }
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
      this.playerListChangeHandler,
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

    // Room Name & ID
    const roomNameEl = document.getElementById('room-name');
    if (roomNameEl && this.gameState.lobbyName) {
      roomNameEl.textContent = this.gameState.lobbyName;
    }

    const lobbyIdEl = document.getElementById('lobby-id-display');
    if (lobbyIdEl && this.gameState.lobbyId) {
      lobbyIdEl.textContent = this.gameState.lobbyId;
    }

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
      .find((p) => p.steamId === this.gameState.network.hostSteamId);
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
      never: 'Never (Manual)',
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
    players.forEach((p) => console.log(`   - ${p.name} (${p.steamId}) - Color: ${p.color}`));

    // Update count
    document.getElementById('player-count').textContent = players.length;

    // Render players as grid cards
    listEl.innerHTML = players.map((player) => {
      const isHost = player.steamId === this.gameState.network.hostSteamId;
      const isLocal = player.steamId === this.gameState.localPlayerId;
      const isReady = player.isReady || isHost; // Host is always "ready"
      const playerColor = player.color || '#808080';

      // Card style
      return `
        <div class="lobby-player-card ${isReady ? 'ready' : ''} ${isLocal ? 'local' : ''}" style="
            background: rgba(30,35,50,0.6); 
            border: 2px solid ${isReady ? '#48bb78' : 'rgba(139,92,246,0.2)'}; 
            border-radius: 12px; 
            padding: 20px; 
            display: flex; 
            flex-direction: column; 
            align-items: center; 
            padding: 20px;
            gap: 10px;
            position: relative;
            overflow: hidden;
        ">
          <!-- Color strip -->
          <div style="
            position: absolute; 
            top: 0; left: 0; right: 0; height: 4px; 
            background: ${playerColor};
            box-shadow: 0 0 10px ${playerColor};
          "></div>
          
          <div class="player-avatar" style="
            width: 64px; height: 64px; 
            border-radius: 50%; 
            background: ${playerColor};
            border: 3px solid rgba(255,255,255,0.2);
            box-shadow: 0 0 20px ${playerColor};
            display: flex; align-items: center; justify-content: center;
            font-size: 24px; font-weight: bold; color: white;
            text-shadow: 0 2px 4px rgba(0,0,0,0.5);
          ">
            ${player.name.substring(0, 1).toUpperCase()}
          </div>
          
          <div class="player-name" style="font-size: 16px; font-weight: 700; color: white; margin-top: 5px;">
            ${this.escapeHtml(player.name)}
          </div>
          
          <div class="player-status" style="font-size: 12px; color: #a0aec0;">
             ${isHost ? '👑 HOST' : isLocal ? 'YOU' : 'PLAYER'}
          </div>
          
          <div class="player-ready-badge" style="
            margin-top: 10px;
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 11px;
            font-weight: 700;
            background: ${isReady ? 'rgba(72,187,120,0.2)' : 'rgba(251,191,36,0.2)'};
            color: ${isReady ? '#48bb78' : '#fbbf24'};
            border: 1px solid ${isReady ? 'rgba(72,187,120,0.4)' : 'rgba(251,191,36,0.4)'};
          ">
             ${isReady ? 'READY' : 'WAITING'}
          </div>
        </div>
      `;
    }).join('');
  }

  /**
 * Update control buttons
 */
  updateControls() {
    const { isHost } = this.gameState;
    const players = Array.from(this.gameState.players.values());
    const readyCount = players.filter((p) => p.isReady || p.steamId === this.gameState.network.hostSteamId).length;
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
    const readyCount = players.filter((p) => p.isReady || p.steamId === this.gameState.network.hostSteamId).length;

    if (players.length < 2) {
      alert('Need at least 2 players to start');
      return;
    }

    if (readyCount < players.length) {
      alert('Not all players are ready');
      return;
    }

    console.log('🚀 Host starting match!');

    // Start the match - this will trigger countdown
    this.gameState.startMatch();

    // Hide waiting room
    this.hide();

    // Note: Don't call onMatchStart callback here!
    // The callback will be triggered by MATCH_STARTED event after countdown completes
    // This ensures host follows the same flow as peers (countdown -> setup UI)
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
    if (!this.container) return;
    const chatEl = this.container.querySelector('#chat-messages');
    if (!chatEl) return;

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
