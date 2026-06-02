/**
 * Lobby Waiting Room
 *
 * Players wait here after joining a lobby before the match starts
 * Shows all connected players, ready states, and host controls
*/

import { onMultiplayerEvent, MULTIPLAYER_EVENTS } from '../events/multiplayer-events.js';
import { createPlayerCard } from './components/player-card.js';
import steamService from '../core/steam/steam-service.js';

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
                <h2 id="room-name" style="font-size: 18px; margin: 10px 0;">Loading...</h2>
            </div>
        </div>

        <div class="match-info-panel" style="flex: 1; overflow-y: auto;">
            <h3>Match Settings</h3>
            <div class="lobby-objective" id="lobby-objective"></div>
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
             <!-- Invite Link / Room Code -->
             <div class="room-code-display">
                <div class="room-code-label">Lobby ID</div>
                <div class="room-code-row">
                   <span class="room-code-value" id="lobby-id-display">Connecting...</span>
                   <button class="lobby-copy-btn" id="copy-lobby-id" title="Copy Lobby ID" aria-label="Copy Lobby ID">
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M5 15V5a2 2 0 0 1 2-2h10"></path></svg>
                   </button>
                </div>
             </div>
             <button class="btn btn-secondary" id="invite-friends-btn" style="width: 100%; margin-top: 10px;">
               INVITE FRIENDS
             </button>
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

        <div class="lobby-ready-progress">
             <div class="ready-progress-track"><div class="ready-progress-fill" id="ready-progress-fill"></div></div>
             <span class="ready-progress-label" id="ready-progress-label">0/0 ready</span>
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
                <input type="text" id="lobby-chat-input" placeholder="Chat..." maxlength="100" style="flex: 1;">
                <button id="lobby-chat-send" style="padding: 0 15px; cursor: pointer; font-weight: bold; border: none;">SEND</button>
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

    // Copy Lobby ID
    const copyBtn = this.container.querySelector('#copy-lobby-id');
    if (copyBtn) {
      copyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = this.container.querySelector('#lobby-id-display')?.textContent || '';
        if (!id || id === 'Connecting...') return;
        const done = () => {
          copyBtn.classList.add('copied');
          setTimeout(() => copyBtn.classList.remove('copied'), 1200);
        };
        if (navigator.clipboard?.writeText) {
          navigator.clipboard.writeText(id).then(done).catch(() => {});
        } else {
          done();
        }
      });
    }

    // Start button
    const startBtn = this.container.querySelector('#start-match-btn');
    startBtn.addEventListener('click', (e) => {
      e.stopPropagation(); // Prevent global click handler from triggering single-player start
      this.startMatch();
    });

    // Invite friends button
    const inviteBtn = this.container.querySelector('#invite-friends-btn');
    if (inviteBtn) {
      inviteBtn.addEventListener('click', async (e) => {
        e.stopPropagation();

        // Check if Steam is available
        if (!steamService.isOnline) {
          this.addChatMessage('[System] Steam is not available. Invites require Steam.', true);
          return;
        }

        const lobbyId = this.gameState?.network?.currentLobbyId || null;
        if (!lobbyId) {
          this.addChatMessage('[System] No lobby active. Cannot send invites.', true);
          return;
        }

        const opened = await steamService.openLobbyInviteDialog(lobbyId);
        if (!opened) {
          console.warn('[LobbyWaitingRoom] Unable to open Steam invite dialog');
          this.addChatMessage('[System] Could not open Steam invite dialog. Try Shift+Tab to open Steam overlay.', true);
        }
      });
    }

    // Chat integration
    // Listen for incoming messages
    this.chatHandler = (detail) => {
      this.addChatMessage({
        playerName: detail.playerName,
        message: detail.message,
        steamId: detail.steamId,
        color: detail.color
      });
    };
    onMultiplayerEvent(MULTIPLAYER_EVENTS.CHAT_MESSAGE, this.chatHandler);

    // Chat input
    const chatInput = this.container.querySelector('#lobby-chat-input');
    const chatSend = this.container.querySelector('#lobby-chat-send');

    const sendChat = () => {
      const text = chatInput.value.trim();
      if (text && this.gameState) {
        const localPlayer = this.gameState.getLocalPlayer?.() || this.gameState.players?.get(this.gameState.localPlayerId);
        const playerColor = localPlayer?.color || '#a78bfa';

        this.gameState.network.sendP2PMessage(this.gameState.network.hostSteamId, 'game:chat', {
          message: text,
          playerName: this.gameState.network.playerName,
          steamId: this.gameState.localPlayerId,
          color: playerColor,
          timestamp: Date.now()
        });

        // Add to local history/UI
        const msgData = {
          message: text,
          playerName: this.gameState.network.playerName,
          steamId: this.gameState.localPlayerId,
          color: playerColor,
          timestamp: Date.now()
        };
        if (this.gameState.chatHistory) this.gameState.chatHistory.push(msgData);
        this.addChatMessage({ ...msgData, playerName: 'You' });
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
          if (!msg.playerName) {
            // System message
            this.addChatMessage(msg.text || msg.message, true);
          } else {
            // Player message - pass full object for color support
            this.addChatMessage(msg);
          }
        });
      }
    }, 50);

    // Update every second
    this.updateInterval = setInterval(() => this.updateUI(), 1000);

    // Listen for player list changes and update immediately
    this.playerListChangeHandler = () => {
      console.log('🔄 Player list changed, updating UI...');
      this._logRosterChanges();
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

    // Objective summary callout
    const objectiveEl = document.getElementById('lobby-objective');
    if (objectiveEl) {
      const cond = conditionText.toLowerCase();
      if (config.endCondition === 'never') {
        objectiveEl.textContent = '∞ Endless — no win condition';
      } else if (config.endCondition === 'time') {
        objectiveEl.textContent = `🎯 ${targetText} — most ${cond} wins`;
      } else {
        objectiveEl.textContent = `🎯 First to ${targetText} ${cond}`;
      }
    }

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

    // Batch preload all avatars in parallel for faster rendering
    const steamIds = players.map(p => p.steamId).filter(Boolean);
    steamService.getAvatarsBatch(steamIds, 'medium').catch(err => {
      console.warn('[LobbyWaitingRoom] Failed to preload avatars:', err.message);
    });

    // Clear and rebuild player cards with real avatars
    listEl.innerHTML = '';

    players.forEach((player) => {
      const isHost = player.steamId === this.gameState.network.hostSteamId;
      const isLocal = player.steamId === this.gameState.localPlayerId;
      const isReady = player.isReady || isHost;
      const playerColor = player.color || '#808080';

      // Create card container (visual styling owned by lobby-room-aaa.css;
      // the per-player neon colour is passed through as a CSS var)
      const cardEl = document.createElement('div');
      cardEl.className = `lobby-player-card ${isReady ? 'ready' : 'not-ready'} ${isLocal ? 'local' : ''} ${isHost ? 'host' : ''}`.trim();
      cardEl.style.setProperty('--player-color', playerColor);

      // Color strip (per-player neon)
      const colorStrip = document.createElement('div');
      colorStrip.className = 'player-color-strip';
      cardEl.appendChild(colorStrip);

      // Player avatar using PlayerCard component
      const playerCard = createPlayerCard({
        steamId: player.steamId,
        name: player.name,
        color: playerColor,
        size: 'medium',
        showName: false,
        vertical: true,
      });
      cardEl.appendChild(playerCard);

      // Player name
      const nameEl = document.createElement('div');
      nameEl.className = 'player-name';
      nameEl.textContent = player.name;
      cardEl.appendChild(nameEl);

      // Player status
      const statusEl = document.createElement('div');
      statusEl.className = 'player-status';
      statusEl.textContent = isHost ? '👑 HOST' : isLocal ? 'YOU' : 'PLAYER';
      cardEl.appendChild(statusEl);

      // Ready badge
      const badgeEl = document.createElement('div');
      badgeEl.className = 'player-ready-badge';
      badgeEl.textContent = isReady ? 'READY' : 'WAITING';
      cardEl.appendChild(badgeEl);

      listEl.appendChild(cardEl);
    });

    // Empty "waiting" ghost slots up to max capacity, so the grid always reads as N/max
    const maxPlayers = parseInt(document.getElementById('max-players-count')?.textContent, 10) || players.length || 8;
    for (let i = players.length; i < maxPlayers; i++) {
      const slot = document.createElement('div');
      slot.className = 'lobby-player-card empty-slot';
      slot.innerHTML = '<div class="empty-slot-icon">+</div><div class="empty-slot-label">Waiting for player…</div>';
      listEl.appendChild(slot);
    }
  }

  /**
 * Update control buttons
 */
  updateControls() {
    const { isHost } = this.gameState;
    const players = Array.from(this.gameState.players.values());
    const readyCount = players.filter((p) => p.isReady || p.steamId === this.gameState.network.hostSteamId).length;
    const minPlayers = 2; // Minimum 2 players to start

    // Ready-progress bar
    const total = players.length;
    const progressFill = document.getElementById('ready-progress-fill');
    const progressLabel = document.getElementById('ready-progress-label');
    if (progressFill) {
      progressFill.style.width = total > 0 ? `${Math.round((readyCount / total) * 100)}%` : '0%';
      progressFill.classList.toggle('all-ready', total > 0 && readyCount === total);
    }
    if (progressLabel) progressLabel.textContent = `${readyCount}/${total} ready`;

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
    this._logRosterChanges();
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
   * Add chat message
   * @param {Object|string} message - Message object with playerName/message/steamId/color, or string for system messages
   * @param {boolean} isSystem - Whether this is a system message (only used for string messages)
   */
  addChatMessage(message, isSystem = true) {
    if (!this.container) return;
    const chatEl = this.container.querySelector('#chat-messages');
    if (!chatEl) return;

    const msgDiv = document.createElement('div');

    // Handle both object format and string format
    if (typeof message === 'string') {
      // Legacy string format or system message
      const msgClass = isSystem ? 'system-message' : 'player-message';
      msgDiv.className = msgClass;
      msgDiv.textContent = message;
    } else {
      // Object format with player info
      const playerColor = message.color || this.getPlayerColor(message.steamId) || '#a78bfa';
      msgDiv.className = 'player-message';
      msgDiv.innerHTML = `
        <span class="color-indicator" style="background: ${playerColor};"></span>
        <span class="author" style="color: ${playerColor};">${this.escapeHtml(message.playerName)}:</span>
        <span class="text">${this.escapeHtml(message.message)}</span>
      `;
    }

    chatEl.appendChild(msgDiv);
    chatEl.scrollTop = chatEl.scrollHeight;
  }

  /**
 * Append an entry to the lobby Activity Log.
 */
  addActivityLogEntry(text, type = 'info') {
    if (!this.container) return;
    const listEl = this.container.querySelector('#activity-log-list');
    if (!listEl) return;
    const entry = document.createElement('div');
    entry.className = `activity-log-entry activity-${type}`;
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    entry.innerHTML = `<span class="activity-dot"></span><span class="activity-text">${this.escapeHtml(text)}</span><span class="activity-time">${time}</span>`;
    listEl.appendChild(entry);
    listEl.scrollTop = listEl.scrollHeight;
  }

  /**
 * Diff the roster against the last snapshot and log join / leave / ready changes.
 */
  _logRosterChanges() {
    if (!this.gameState) return;
    const hostId = this.gameState.network?.hostSteamId;
    const next = new Map();
    Array.from(this.gameState.players.values()).forEach((p) => {
      next.set(p.steamId, { name: p.name, ready: !!(p.isReady || p.steamId === hostId) });
    });

    // First sync: seed without spamming "joined" for the initial roster.
    if (!this._activitySnapshot) {
      this._activitySnapshot = next;
      this.addActivityLogEntry('Lobby ready — waiting for players', 'info');
      return;
    }

    next.forEach((info, id) => {
      const prev = this._activitySnapshot.get(id);
      if (!prev) {
        this.addActivityLogEntry(`${info.name} joined`, 'join');
      } else if (prev.ready !== info.ready) {
        this.addActivityLogEntry(`${info.name} ${info.ready ? 'is ready' : 'is not ready'}`, info.ready ? 'ready' : 'unready');
      }
    });
    this._activitySnapshot.forEach((info, id) => {
      if (!next.has(id)) this.addActivityLogEntry(`${info.name} left`, 'leave');
    });
    this._activitySnapshot = next;
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
