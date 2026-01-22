/**
 * Match Results Modal
 *
 * Displays final standings, stats, and actions after a match ends.
 */

export class MatchResultsModal {
    constructor(options = {}) {
        this.onPlayAgain = options.onPlayAgain || (() => {});
        this.onReturnToLobby = options.onReturnToLobby || (() => {});
        this.onExit = options.onExit || (() => {});

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
        this.container.className = 'match-results-modal hidden';
        this.container.setAttribute('role', 'dialog');
        this.container.setAttribute('aria-modal', 'true');

        this.container.innerHTML = `
      <div class="match-results-overlay"></div>
      <div class="match-results-content">
        <div class="match-results-header">
          <div class="match-results-title">Match Results</div>
          <div class="match-results-subtitle" id="match-results-subtitle"></div>
        </div>

        <div class="match-results-winner">
          <div class="winner-label">Champion</div>
          <div class="winner-name" id="match-results-winner-name">-</div>
          <div class="winner-meta" id="match-results-winner-meta"></div>
        </div>

        <div class="match-results-grid">
          <div class="match-results-standings">
            <div class="section-title">Final Standings</div>
            <div class="standings-list" id="match-results-standings"></div>
          </div>
          <div class="match-results-kill-feed">
            <div class="section-title">Kill Feed</div>
            <div class="match-results-kill-list" id="match-results-kill-feed"></div>
          </div>
        </div>

        <div class="match-results-stats">
          <div class="section-title">Player Stats</div>
          <div class="stats-table-wrapper" id="match-results-stats-table"></div>
        </div>

        <div class="match-results-actions">
          <div class="host-hint" id="match-results-host-hint"></div>
          <div class="actions-right">
            <button class="btn btn-primary" id="match-results-play-again">Play Again</button>
            <button class="btn btn-secondary" id="match-results-return-lobby">Return to Lobby</button>
            <button class="btn btn-danger" id="match-results-exit">Exit</button>
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
    }

    /**
     * Show modal with results
     */
    show(results, options = {}) {
        if (!results) return;

        this.isHost = options.isHost === true;
        this.localPlayerId = options.localPlayerId || null;

        this.updateContent(results);
        this.updateHostState();

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
              <th>Player</th>
              <th>Frags</th>
              <th>Deaths</th>
              <th>Score</th>
              <th>Lines</th>
              <th>APM</th>
            </tr>
          </thead>
          <tbody>
            ${standings.map((player) => {
                    const isLocal = this.localPlayerId && player.steamId === this.localPlayerId;
                    const isWinner = player.steamId && winnerId && player.steamId === winnerId;
                    const rowClass = [
                        isLocal ? 'local' : '',
                        isWinner ? 'winner' : '',
                    ].filter(Boolean).join(' ');
                    const colorStyle = player.color ? `style="background:${player.color}"` : '';
                    return `
              <tr class="${rowClass}">
                <td>
                  <span class="player-color-dot" ${colorStyle}></span>
                  ${this.escapeHtml(player.name)}
                </td>
                <td>${player.frags || 0}</td>
                <td>${player.deaths || 0}</td>
                <td>${this.formatNumber(player.score || 0)}</td>
                <td>${player.lines || 0}</td>
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
