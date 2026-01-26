/**
 * Match Results Modal
 *
 * Displays final standings, stats, and actions after a match ends.
 */

export class MatchResultsModal {
  constructor(options = {}) {
    this.onPlayAgain = options.onPlayAgain || (() => { });
    this.onReturnToLobby = options.onReturnToLobby || (() => { });
    this.onExit = options.onExit || (() => { });

    this.container = null;
    this.playAgainBtn = null;
    this.returnLobbyBtn = null;
    this.exitBtn = null;
    this.hostHint = null;
    this.isHost = false;
    this.localPlayerId = null;
    this.isVisible = false;

    this.createUI();
  }

  /**
 * Create modal UI
 */
  createUI() {
    this.container = document.createElement('div');
    this.container.id = 'match-results-modal';
    // Use unified grid layout
    this.container.className = 'online-game-area results-mode hidden';

    // Accessibility (dialog role still valid for fullscreen overlay)
    this.container.setAttribute('role', 'dialog');
    this.container.setAttribute('aria-modal', 'true');

    this.container.innerHTML = `
      <!-- LEFT PANEL: Summary & Actions -->
      <div class="opponents-panel results-left-panel" style="background: rgba(15,20,30,0.8); border: 1px solid rgba(102,126,234,0.3); border-radius: 12px; padding: 20px; display: flex; flex-direction: column; gap: 20px;">
          <!-- Header -->
          <div class="results-header" style="border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 10px;">
             <h2 class="results-title" style="font-size: 20px; color: #fff; margin: 0;">MATCH RESULTS</h2>
             <div class="results-subtitle" id="match-results-subtitle" style="color: #a0aec0; font-size: 12px; margin-top: 5px;"></div>
          </div>
          
          <!-- Winner Display -->
          <div class="match-results-winner" style="text-align: center; padding: 30px 20px; background: rgba(0,0,0,0.2); border-radius: 12px; border: 1px solid rgba(251, 191, 36, 0.2);">
             <div class="winner-label" style="color: #fbbf24; font-size: 12px; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 10px;">Champion</div>
             <div class="winner-name" id="match-results-winner-name" style="font-size: 36px; font-weight: 900; color: #fff; text-shadow: 0 0 30px rgba(251, 191, 36, 0.4); margin-bottom: 5px;">-</div>
             <div class="winner-meta" id="match-results-winner-meta" style="color: #cbd5e0; font-family: 'Space Mono', monospace;"></div>
          </div>
          
          <!-- Spacer -->
          <div style="flex: 1;"></div>
          
          <!-- Actions (Moved to Left) -->
          <div class="match-results-actions" style="display: flex; flex-direction: column; gap: 12px;">
             <div class="host-hint" id="match-results-host-hint" style="color: #a0aec0; font-size: 11px; text-align: center; margin-bottom: 5px;"></div>
             <button class="btn btn-primary" id="match-results-play-again" style="padding: 12px; width: 100%;">Vote Rematch</button>
             <button class="btn btn-secondary" id="match-results-return-lobby" style="padding: 12px; width: 100%;">Return to Lobby</button>
             <button class="btn btn-danger" id="match-results-exit" style="padding: 12px; width: 100%;">Exit</button>
          </div>
      </div>

      <!-- CENTER PANEL: Detailed Stats Table -->
      <div class="main-board-panel results-center-panel" style="background: rgba(15,20,30,0.6); border: 1px solid rgba(139, 92, 246, 0.2); border-radius: 12px; padding: 20px; display: flex; flex-direction: column;">
          <div class="section-title" style="color: #c4b5fd; margin-bottom: 15px; font-size: 14px; font-weight: bold; text-transform: uppercase;">Performance Statistics</div>
          <div class="match-results-stats" style="flex: 1; overflow-y: auto;">
             <div class="stats-table-wrapper" id="match-results-stats-table"></div>
          </div>
      </div>

      <!-- RIGHT PANEL: Chat & Activity -->
      <div class="right-panel">
         <!-- Battle Log -->
         <div class="online-kill-feed" style="max-height: 200px; flex: 0 0 auto;">
            <div class="kill-feed-header">Battle Log</div>
            <div class="match-results-kill-list" id="match-results-kill-feed" style="overflow-y: auto; max-height: 160px;"></div>
         </div>
         
         <!-- Chat -->
         <div class="online-chat">
            <div class="chat-messages" id="results-chat-messages"></div>
            <div class="chat-input-row" style="display: flex; gap: 8px; padding: 10px; background: rgba(0,0,0,0.3);">
                <input type="text" id="results-chat-input" placeholder="Chat..." maxlength="100" style="flex: 1; background: rgba(255,255,255,0.1); border: 1px solid rgba(139,92,246,0.3); color: white; padding: 8px; border-radius: 4px;">
                <button id="results-chat-send" style="background: #8b5cf6; border: none; color: white; padding: 0 15px; border-radius: 4px; cursor: pointer; font-weight: bold;">SEND</button>
            </div>
         </div>
      </div>
    `;

    document.body.appendChild(this.container);

    this.playAgainBtn = this.container.querySelector('#match-results-play-again');
    this.returnLobbyBtn = this.container.querySelector('#match-results-return-lobby');
    this.exitBtn = this.container.querySelector('#match-results-exit');
    this.hostHint = this.container.querySelector('#match-results-host-hint');

    this.setupEventListeners();
  }

  /**
 * Setup button handlers
 */
  setupEventListeners() {
    if (this.playAgainBtn) {
      this.playAgainBtn.addEventListener('click', () => {
        if (!this.playAgainBtn.disabled) {
          this.onPlayAgain();
        }
      });
    }

    if (this.returnLobbyBtn) {
      this.returnLobbyBtn.addEventListener('click', () => {
        this.onReturnToLobby();
      });
    }

    if (this.exitBtn) {
      this.exitBtn.addEventListener('click', () => {
        this.onExit();
      });
    }

    // Chat Logic
    const chatInput = this.container.querySelector('#results-chat-input');
    const chatSend = this.container.querySelector('#results-chat-send');

    const sendChat = () => {
      const text = chatInput.value.trim();
      if (text && this.gameState && this.gameState.network) {
        this.gameState.network.sendP2PMessage(this.gameState.network.hostSteamId, 'game:chat', {
          message: text,
          playerName: this.gameState.network.playerName,
          steamId: this.gameState.localPlayerId,
          timestamp: Date.now()
        });

        // Add to local history/UI immediately for responsiveness
        // Note: GameState event handler will also catch it if we broadcast back, 
        // but usually we want instant feedback.
        // However, FFAGameStateP2P logic for 'game:chat' says:
        // "If host, rebroadcast... Dispatch to UI... Log..."
        // It does NOT auto-add to local history if it's from self UNLESS we rely on the loopback or manually add.
        // Let's manually add here to be safe and efficient.
        const msgData = {
          message: text,
          playerName: this.gameState.network.playerName,
          steamId: this.gameState.localPlayerId,
          timestamp: Date.now()
        };

        // Check if already handled by gamestate listener (to avoid dupes)
        // The listener pushes to chatHistory. 
        // If we push here, we might dupe.
        // Let's rely on the listener if it handles local echo. 
        // FFAGameStateP2P:375 "this.network.on('game:chat', (msg) => { ... this.chatHistory.push ... })"
        // Does SteamNetworking trigger .on for messages sent by self? Usually NO.
        // So we MUST add manually.

        if (this.gameState.chatHistory) {
          this.gameState.chatHistory.push(msgData);
        }
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

  addChatMessage(message, isSystem = true) {
    if (!this.container) return;
    const chatEl = this.container.querySelector('#results-chat-messages');
    if (!chatEl) return;

    const msgClass = isSystem ? 'system-message' : 'player-message';
    const msgDiv = document.createElement('div');
    msgDiv.className = msgClass;
    msgDiv.textContent = message;
    chatEl.appendChild(msgDiv);
    chatEl.scrollTop = chatEl.scrollHeight;
  }

  /**
 * Show modal with results
 */
  show(results, options = {}) {
    if (!results) return;

    this.isHost = options.isHost === true;
    this.localPlayerId = options.localPlayerId || null;
    this.gameState = options.gameState;

    this.updateContent(results);
    this.updateHostState();

    // Restore chat history
    const chatEl = this.container.querySelector('#results-chat-messages');
    if (chatEl) {
      chatEl.innerHTML = '';
      if (this.gameState && this.gameState.chatHistory) {
        this.gameState.chatHistory.forEach(msg => {
          const isSystem = !msg.playerName;
          const text = isSystem ? msg.text : `${msg.playerName}: ${msg.message}`;
          this.addChatMessage(text, isSystem);
        });
      }
    }

    this.container.classList.remove('hidden');
    this.container.classList.add('visible');
    this.isVisible = true;
  }

  /**
 * Hide modal
 */
  hide() {
    if (!this.container) return;
    this.container.classList.remove('visible');
    this.isVisible = false;

    setTimeout(() => {
      if (!this.isVisible) {
        this.container.classList.add('hidden');
      }
    }, 220);
  }

  /**
 * Update modal content
 */
  updateContent(results) {
    const standings = Array.isArray(results.finalStats) ? results.finalStats.slice() : [];
    standings.sort((a, b) => (a.placement || 0) - (b.placement || 0));

    const winnerId = typeof results.winner === 'string'
      ? results.winner
      : results.winner?.steamId || null;
    const winnerName = results.winnerName || results.winner?.name || 'Draw';
    const winCondition = this.formatWinCondition(results.endCondition, results.endConditionValue);
    const duration = this.formatDuration(results.duration);

    const subtitleEl = this.container.querySelector('#match-results-subtitle');
    if (subtitleEl) {
      subtitleEl.textContent = `${winCondition} • ${duration}`;
    }

    const winnerEl = this.container.querySelector('#match-results-winner-name');
    if (winnerEl) {
      winnerEl.textContent = winnerName;
    }

    const winnerMetaEl = this.container.querySelector('#match-results-winner-meta');
    if (winnerMetaEl) {
      const topStat = standings[0];
      if (topStat) {
        winnerMetaEl.textContent = `${topStat.frags || 0} frags • ${this.formatNumber(topStat.score || 0)} pts`;
      } else {
        winnerMetaEl.textContent = '';
      }
    }

    const standingsEl = this.container.querySelector('#match-results-standings');
    if (standingsEl) {
      standingsEl.innerHTML = standings.map((player, index) => {
        const placement = player.placement || index + 1;
        const medal = this.formatPlacement(placement);
        const isLocal = this.localPlayerId && player.steamId === this.localPlayerId;
        const isWinner = player.steamId && winnerId && player.steamId === winnerId;
        const classes = [
          'standings-row',
          isLocal ? 'local' : '',
          isWinner ? 'winner' : '',
        ].filter(Boolean).join(' ');

        const colorStyle = player.color ? `style="background:${player.color}"` : '';

        return `
          <div class="${classes}">
            <span class="standings-rank">${medal}</span>
            <span class="standings-name">
              <span class="player-color-dot" ${colorStyle}></span>
              ${this.escapeHtml(player.name)}
            </span>
            <span class="standings-frags">${player.frags || 0} frags</span>
            <span class="standings-score">${this.formatNumber(player.score || 0)} pts</span>
          </div>
        `;
      }).join('');
    }

    const killFeedEl = this.container.querySelector('#match-results-kill-feed');
    if (killFeedEl) {
      const killFeed = Array.isArray(results.killFeed) ? results.killFeed : [];
      if (killFeed.length === 0) {
        killFeedEl.innerHTML = '<div class="match-results-empty">No eliminations recorded.</div>';
      } else {
        killFeedEl.innerHTML = killFeed.slice(0, 10).map((entry) => {
          if (!entry.killer) {
            return `
              <div class="match-kill-item self">
                <span class="victim">${this.escapeHtml(entry.victim || 'Unknown')}</span>
                <span class="kill-note">self-eliminated</span>
              </div>
            `;
          }
          return `
            <div class="match-kill-item">
              <span class="killer">${this.escapeHtml(entry.killer)}</span>
              <span class="kill-icon">⚔️</span>
              <span class="victim">${this.escapeHtml(entry.victim)}</span>
            </div>
          `;
        }).join('');
      }
    }

    const statsTableEl = this.container.querySelector('#match-results-stats-table');
    if (statsTableEl) {
      const header = `
        <table class="stats-table">
          <thead>
            <tr>
              <th class="col-rank">#</th>
              <th>Player</th>
              <th>Frags</th>
              <th>Deaths</th>
              <th>Score</th>
              <th>Lines</th>
              <th>BPM</th>
              <th>PPM</th>
              <th>APM</th>
            </tr>
          </thead>
          <tbody>
            ${standings.map((player, index) => {
        const placement = player.placement || index + 1;
        const medal = this.formatPlacement(placement);
        const isLocal = this.localPlayerId && player.steamId === this.localPlayerId;
        const isWinner = player.steamId && winnerId && player.steamId === winnerId;
        const rowClass = [
          isLocal ? 'local' : '',
          isWinner ? 'winner' : '',
        ].filter(Boolean).join(' ');
        const colorStyle = player.color ? `style="background:${player.color}"` : '';
        return `
              <tr class="${rowClass}">
                <td class="col-rank">${medal}</td>
                <td class="col-player">
                  <div class="player-stats-wrapper">
                    <span class="player-color-dot" ${colorStyle}></span>
                    ${this.escapeHtml(player.name)}
                  </div>
                </td>
                <td>${player.frags || 0}</td>
                <td>${player.deaths || 0}</td>
                <td>${this.formatNumber(player.score || 0)}</td>
                <td>${player.lines || 0}</td>
                <td>${player.bpm || 0}</td>
                <td>${player.ppm || 0}</td>
                <td>${player.apm || 0}</td>
              </tr>
            `;
      }).join('')}
          </tbody>
        </table>
      `;
      statsTableEl.innerHTML = header;
    }
  }

  /**
 * Update host-specific UI state
 */
  updateHostState() {
    if (!this.playAgainBtn || !this.hostHint) return;

    if (this.isHost) {
      this.playAgainBtn.disabled = false;
      this.playAgainBtn.classList.remove('btn-disabled');
      this.hostHint.textContent = '';
    } else {
      this.playAgainBtn.disabled = true;
      this.playAgainBtn.classList.add('btn-disabled');
      this.hostHint.textContent = 'Waiting for host to start a rematch.';
    }
  }

  formatPlacement(place) {
    switch (place) {
      case 1: return '🥇';
      case 2: return '🥈';
      case 3: return '🥉';
      default: return `${place}.`;
    }
  }

  formatWinCondition(endCondition, value) {
    const safeValue = typeof value === 'number' ? value : '-';
    const conditions = {
      frags: `First to ${safeValue} frags`,
      time: `${safeValue} minute limit`,
      points: `First to ${safeValue}k points`,
      lines: `First to ${safeValue} lines`,
      never: 'Endless',
    };
    return conditions[endCondition] || 'Match Complete';
  }

  formatDuration(durationMs) {
    if (!durationMs || durationMs <= 0) return '0:00';
    const totalSeconds = Math.floor(durationMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  formatNumber(value) {
    if (typeof value !== 'number') return value || 0;
    return value.toLocaleString();
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }

  /**
 * Destroy modal
 */
  destroy() {
    if (this.container) {
      this.container.remove();
    }
    this.container = null;
    this.playAgainBtn = null;
    this.returnLobbyBtn = null;
    this.exitBtn = null;
    this.hostHint = null;
  }
}
