/**
 * Match Results Modal (online)
 *
 * Final standings, the winner, the battle log and chat after a match ends. One
 * primary action: Rematch for the host; Back to lobby for everyone else (only the
 * host can start a rematch). Escape leaves a text field first, then goes back to
 * the lobby. Styles: public/styles/keystone-multiplayer.css (#match-results-modal).
 */

import steamService from '../core/steam/steam-service.js';
import { onMultiplayerEvent, MULTIPLAYER_EVENTS } from '../events/multiplayer-events.js';
import { MessageTypes } from '../core/network/message-types.js';
import { escapeAttribute, sanitizeCssColor } from '../utils/dom-safety.js';
import { csIcon } from './components/cosmic-icons.js';
import {
    closeLayer, describeGoal, mpIcon, openLayer,
} from './components/mp-sheet.js';
import { primaryMetric } from './scoreboard-metrics.js';

// What each player did, in the order it matters; the column that decided the match is
// marked. Pace once (pieces per second; blocks per minute was the same number times 60),
// attack once (lines sent; the attack count and APM say the same thing twice).
const STAT_COLUMNS = [
    ['frags', 'Frags'],
    ['deaths', 'Deaths'],
    ['score', 'Score'],
    ['lines', 'Lines'],
    ['pps', 'PPS', 'Pieces per second'],
    ['apm', 'APM', 'Attacks per minute'],
    ['attackLinesSent', 'Sent', 'Garbage lines sent'],
];

/* Player colours are hex (PLAYER_COLORS); plain rgb()/hsl() numbers are allowed too. */
const NUMERIC_COLOR = /^(?:rgb|hsl)a?\(\s*[\d.]+(?:deg)?%?(?:\s*[,/\s]\s*[\d.]+%?){2,3}\s*\)$/i;
function playerColor(value, fallback) {
    return typeof value === 'string' && NUMERIC_COLOR.test(value.trim())
        ? value.trim() : sanitizeCssColor(value, fallback);
}

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
        this.chatUnsub = null;
        this.chatHandler = null;
        this._autoReturnInterval = null; // cosmetic "returning to lobby in N s" ticker
        this._baseHint = '';

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

        this.container.setAttribute('role', 'dialog');
        this.container.setAttribute('aria-modal', 'true');
        this.container.setAttribute('aria-labelledby', 'match-results-title');
        this.container.setAttribute('aria-describedby', 'match-results-winner-name');

        this.container.innerHTML = `
      <!-- LEFT PANEL: Winner & Actions -->
      <div class="opponents-panel results-left-panel mr-panel">
          <div class="results-header">
             <p class="sb-eyebrow">Match complete</p>
             <h2 class="results-title" id="match-results-title">Results</h2>
             <p class="results-subtitle" id="match-results-subtitle"></p>
          </div>

          <div class="match-results-winner">
             <div class="winner-label">${mpIcon('crown', 14)}<span>Winner</span></div>
             <div class="winner-avatar-container" id="winner-avatar-container">
               <div class="winner-avatar-placeholder" aria-hidden="true">?</div>
             </div>
             <div class="winner-name" id="match-results-winner-name">–</div>
             <div class="winner-meta" id="match-results-winner-meta"></div>
          </div>

          <div class="results-spacer"></div>

          <div class="match-results-actions">
             <p class="host-hint" id="match-results-host-hint" aria-live="polite"></p>
             <button type="button" class="sb-btn sb-btn--primary" id="match-results-play-again">${mpIcon('rematch', 16)}<span>Rematch</span></button>
             <button type="button" class="sb-btn" id="match-results-return-lobby">${mpIcon('people', 16)}<span>Back to lobby</span></button>
             <button type="button" class="sb-btn sb-btn--quiet" id="match-results-exit">${mpIcon('home', 16)}<span>Main menu</span></button>
          </div>
      </div>

      <!-- CENTER PANEL: Standings -->
      <div class="main-board-panel results-center-panel mr-panel">
          <h3 class="section-title sb-mp-label">Standings</h3>
          <div class="match-results-stats">
             <div class="stats-table-wrapper" id="match-results-stats-table"></div>
          </div>
      </div>

      <!-- RIGHT PANEL: Battle log & Chat -->
      <div class="right-panel">
         <section class="online-kill-feed results-battle-log mr-panel" aria-labelledby="match-results-log-title">
            <h3 class="kill-feed-header sb-mp-label" id="match-results-log-title">Battle log</h3>
            <div class="match-results-kill-list" id="match-results-kill-feed"></div>
         </section>

         <section class="online-chat mr-panel" aria-labelledby="match-results-chat-title">
            <h3 class="sb-mp-label mr-chat__title" id="match-results-chat-title">Chat</h3>
            <div class="chat-messages" id="results-chat-messages" role="log" aria-live="polite"></div>
            <form class="chat-input-row" id="results-chat-form" novalidate>
                <input type="text" id="results-chat-input" class="sb-mp-input" placeholder="Say something" maxlength="100" autocomplete="off" aria-label="Chat message">
                <button type="submit" class="sb-btn wr-send" id="results-chat-send" aria-label="Send message">${mpIcon('send', 16)}</button>
            </form>
         </section>
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
        const chatForm = this.container.querySelector('#results-chat-form');

        const sendChat = () => {
            const text = chatInput.value.trim();
            if (!text) return;

            const localPlayer = this.gameState?.getLocalPlayer?.()
        || this.gameState?.players?.get(this.gameState?.localPlayerId);
            const localColor = localPlayer?.color || '#a78bfa';
            const playerName = this.gameState?.network?.playerName || 'You';
            const steamId = this.gameState?.localPlayerId || 'local';

            const payload = {
                message: text,
                playerName,
                steamId,
                color: localColor,
                timestamp: Date.now(),
            };

            if (this.gameState?.network) {
                if (this.gameState.network.isHost) {
                    this.gameState.network.broadcastToAll(MessageTypes.GAME_CHAT, payload);
                } else if (this.gameState.network.sendP2PMessage && this.gameState.network.hostSteamId) {
                    this.gameState.network.sendP2PMessage(
                        this.gameState.network.hostSteamId,
                        MessageTypes.GAME_CHAT,
                        payload,
                    );
                }
            }

            // Add to local history/UI immediately for responsiveness (even if network missing)
            if (this.gameState?.chatHistory) {
                this.gameState.chatHistory.push(payload);
            }
            this.addChatMessage({ ...payload, playerName: 'You' });
            chatInput.value = '';
        };

        chatForm?.addEventListener('submit', (e) => {
            e.preventDefault();
            e.stopPropagation();
            sendChat();
        });
        // Keys typed here are chat, not gameplay (Escape is handled by the screen first).
        if (chatInput) chatInput.addEventListener('keydown', (e) => e.stopPropagation());
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
        const chatEl = this.container.querySelector('#results-chat-messages');
        if (!chatEl) return;

        const msgDiv = document.createElement('div');

        // Handle both object format and string format
        if (typeof message === 'string') {
            // Legacy string format or system message
            msgDiv.className = isSystem ? 'system-message' : 'player-message';
            msgDiv.textContent = message;
        } else {
            // Object format with player info
            const color = playerColor(message.color || this.getPlayerColor(message.steamId), '#a78bfa');
            msgDiv.className = 'player-message';
            msgDiv.style.setProperty('--player-color', color);
            msgDiv.innerHTML = `
        <span class="color-indicator" aria-hidden="true"></span>
        <span class="author">${this.escapeHtml(message.playerName)}</span>
        <span class="text">${this.escapeHtml(message.message ?? message.text ?? '')}</span>
      `;
        }

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
        this._startAutoReturnCountdown(options.autoReturnMs);

        if (!this.chatUnsub) {
            this.chatHandler = (detail) => {
                if (!this.isVisible) return;
                this.addChatMessage({
                    playerName: detail.playerName,
                    message: detail.message,
                    steamId: detail.steamId,
                    color: detail.color || this.getPlayerColor(detail.steamId),
                    timestamp: detail.timestamp,
                });
            };
            this.chatUnsub = onMultiplayerEvent(MULTIPLAYER_EVENTS.CHAT_MESSAGE, this.chatHandler);
        }

        // Restore chat history
        const chatEl = this.container.querySelector('#results-chat-messages');
        if (chatEl) {
            chatEl.innerHTML = '';
            if (this.gameState && this.gameState.chatHistory) {
                this.gameState.chatHistory.forEach((msg) => {
                    if (!msg.playerName) {
                        // System message
                        this.addChatMessage(msg.text || msg.message, true);
                    } else {
                        // Player message - pass full object for color support
                        this.addChatMessage(msg);
                    }
                });
            }
        }

        this.container.classList.remove('hidden');
        this.container.classList.add('visible');
        this.isVisible = true;
        openLayer(this.container, () => this.onReturnToLobby(), { fieldsFirst: true });

        // Focus the one primary action (Rematch for the host, Back to lobby otherwise).
        const primary = this.isHost ? this.playAgainBtn : this.returnLobbyBtn;
        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(() => {
                if (this.isVisible && primary && !this.container.contains(document.activeElement)) {
                    primary.focus({ preventScroll: true });
                }
            });
        }
    }

    /**
 * Hide modal
 */
    hide() {
        if (!this.container) return;
        this._stopAutoReturnCountdown();
        this.container.classList.remove('visible');
        this.isVisible = false;
        closeLayer(this.container);

        setTimeout(() => {
            if (!this.isVisible) {
                this.container?.classList.add('hidden');
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
            subtitleEl.textContent = `${winCondition} · ${duration}`;
        }

        const winnerEl = this.container.querySelector('#match-results-winner-name');
        if (winnerEl) {
            winnerEl.textContent = winnerName;
        }

        // The winner's line leads with what decided the match; a draw has none.
        const winnerStats = winnerId ? standings.find((p) => p.steamId === winnerId) : null;
        const winnerMetaEl = this.container.querySelector('#match-results-winner-meta');
        if (winnerMetaEl) {
            winnerMetaEl.textContent = winnerStats ? this.formatWinnerMeta(winnerStats, results.endCondition) : '';
        }

        // Load winner avatar
        this._loadWinnerAvatar(winnerId, winnerName, winnerStats?.color || '#f3d28d');

        const killFeedEl = this.container.querySelector('#match-results-kill-feed');
        if (killFeedEl) {
            const killFeed = Array.isArray(results.killFeed) ? results.killFeed : [];
            if (killFeed.length === 0) {
                killFeedEl.innerHTML = '<div class="match-results-empty">No eliminations this match.</div>';
            } else {
                killFeedEl.innerHTML = killFeed.slice(0, 10).map((entry) => {
                    if (!entry.killer) {
                        return `
              <div class="match-kill-item self">
                <span class="kill-icon" aria-hidden="true">${csIcon('skull', 14)}</span>
                <span class="victim">${this.escapeHtml(entry.victim || 'Unknown')}</span>
                <span class="kill-note">topped out</span>
              </div>
            `;
                    }
                    return `
            <div class="match-kill-item">
              <span class="killer">${this.escapeHtml(entry.killer)}</span>
              <span class="kill-icon" aria-label="eliminated" role="img">${csIcon('crossed-swords', 14)}</span>
              <span class="victim">${this.escapeHtml(entry.victim)}</span>
            </div>
          `;
                }).join('');
            }
        }

        const statsTableEl = this.container.querySelector('#match-results-stats-table');
        if (statsTableEl) {
            const goal = primaryMetric(results.endCondition);
            // Each column named (a phone keeps the deciding few); the deciding one marked.
            const col = (key) => ` data-col="${key}"${key === goal ? ' class="is-goal"' : ''}`;
            const head = STAT_COLUMNS.map(([key, label, title]) => (title
                ? `<th scope="col"${col(key)}><abbr title="${title}">${label}</abbr></th>`
                : `<th scope="col"${col(key)}>${label}</th>`)).join('');
            const rows = standings.map((player, index) => {
                const placement = Math.max(1, Math.floor(Number(player.placement) || index + 1));
                const isLocal = this.localPlayerId && player.steamId === this.localPlayerId;
                const isWinner = player.steamId && winnerId && player.steamId === winnerId;
                const rowClass = [isLocal ? 'local' : '', isWinner ? 'winner' : ''].filter(Boolean).join(' ');
                const color = playerColor(player.color, '#b8a4ff');
                const cells = STAT_COLUMNS.map(([key]) => {
                    const value = player[key] || 0;
                    const text = key === 'score' ? this.formatNumber(value) : this.escapeHtml(String(value));
                    return `<td${col(key)}>${text}</td>`;
                }).join('');
                return `
              <tr class="${rowClass}" style="--player-color:${color}">
                <td class="col-rank"><span class="mr-place mr-place--${Math.min(placement, 4)}">${placement}</span></td>
                <th scope="row" class="col-player">
                  <div class="player-stats-wrapper">
                    <span class="player-color-dot" aria-hidden="true"></span>
                    <span class="mr-player-name" title="${escapeAttribute(player.name || '')}">${this.escapeHtml(player.name)}</span>
                    ${isLocal ? '<span class="mr-you">You</span>' : ''}
                  </div>
                </th>
                ${cells}
              </tr>`;
            }).join('');
            statsTableEl.innerHTML = `
        <table class="stats-table">
          <caption class="mr-sr">Final standings</caption>
          <thead>
            <tr>
              <th scope="col" class="col-rank"><abbr title="Place">#</abbr></th>
              <th scope="col" class="col-player">Player</th>
              ${head}
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      `;
        }
    }

    /**
 * Update host-specific UI state
 */
    updateHostState() {
        if (!this.playAgainBtn || !this.hostHint) return;

        this.playAgainBtn.disabled = !this.isHost;
        this.playAgainBtn.classList.toggle('btn-disabled', !this.isHost);
        // One primary action: Rematch for the host, Back to lobby for everyone else.
        this.playAgainBtn.classList.toggle('sb-btn--primary', this.isHost);
        this.returnLobbyBtn?.classList.toggle('sb-btn--primary', !this.isHost);
        this._baseHint = this.isHost ? '' : 'Only the host can start a rematch.';
        this.hostHint.textContent = this._baseHint;
    }

    /**
   * Cosmetic countdown shown to ALL clients: "<base hint> · Back to the lobby in N s".
   * The authoritative auto-return is driven host-side (it broadcasts RETURN_TO_LOBBY); this
   * is purely the visible heads-up so nobody is surprised when the screen advances.
   */
    _startAutoReturnCountdown(autoReturnMs) {
        this._stopAutoReturnCountdown();
        if (!this.hostHint || !autoReturnMs || autoReturnMs <= 0) return;
        const baseHint = this._baseHint || '';
        const endsAt = Date.now() + autoReturnMs;
        const render = () => {
            const remaining = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
            const suffix = `Back to the lobby in ${remaining} s`;
            this.hostHint.textContent = baseHint ? `${baseHint} ${suffix}.` : `${suffix}.`;
            if (remaining <= 0) this._stopAutoReturnCountdown();
        };
        render();
        this._autoReturnInterval = setInterval(render, 1000);
    }

    _stopAutoReturnCountdown() {
        if (this._autoReturnInterval) {
            clearInterval(this._autoReturnInterval);
            this._autoReturnInterval = null;
        }
    }

    /**
   * Load winner's large avatar
   * @private
   */
    async _loadWinnerAvatar(steamId, name, color) {
        const container = this.container?.querySelector('#winner-avatar-container');
        if (!container) return;

        // Reset to placeholder
        const letter = (name || 'W').charAt(0).toUpperCase();
        container.innerHTML = `<div class="winner-avatar-placeholder" aria-hidden="true">${this.escapeHtml(letter)}</div>`;
        container.style.setProperty('--winner-color', playerColor(color, '#f3d28d'));

        if (!steamId) return;

        try {
            const avatarUrl = await steamService.getAvatar(steamId, 'large');
            if (avatarUrl) {
                const img = document.createElement('img');
                img.className = 'winner-avatar-image';
                img.src = avatarUrl;
                img.alt = '';
                img.onerror = () => {
                    // Keep placeholder on error
                    img.remove();
                };
                container.innerHTML = '';
                container.appendChild(img);
            }
        } catch (err) {
            console.warn('[MatchResultsModal] Failed to load winner avatar:', err.message);
        }
    }

    /**
     * The winner's numbers, the one that decided the match first: "5 frags · 12,300
     * points", "40 lines · 9,800 points", "12,300 points · 40 lines".
     */
    formatWinnerMeta(stats, endCondition) {
        const metric = primaryMetric(endCondition);
        const second = metric === 'score' ? 'lines' : 'score';
        const count = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
        const words = {
            frags: (n) => count(n, 'frag'),
            lines: (n) => count(n, 'line'),
            score: (n) => `${this.formatNumber(n)} points`,
        };
        return `${words[metric](stats[metric] || 0)} · ${words[second](stats[second] || 0)}`;
    }

    formatWinCondition(endCondition, value) {
        if (!endCondition) return 'Match complete';
        // The host's lobby data may carry the goal as a string ("10").
        return describeGoal(endCondition, value);
    }

    formatDuration(durationMs) {
        if (!durationMs || durationMs <= 0) return '0:00';
        const totalSeconds = Math.floor(durationMs / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }

    formatNumber(value) {
        return (Number(value) || 0).toLocaleString();
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
        if (this.chatUnsub) {
            this.chatUnsub();
            this.chatUnsub = null;
            this.chatHandler = null;
        }
        this._stopAutoReturnCountdown();
        if (this.container) {
            closeLayer(this.container);
            this.container.remove();
        }
        this.container = null;
        this.playAgainBtn = null;
        this.returnLobbyBtn = null;
        this.exitBtn = null;
        this.hostHint = null;
    }
}
