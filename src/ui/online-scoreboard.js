/**
 * OnlineScoreboard - Right-panel scoreboard for online multiplayer
 *
 * Features:
 * - Shows all players sorted by frags (or other metric)
 * - Highlights local player
 * - Shows goal/win condition
 * - Updates in real-time from network state
 */
export class OnlineScoreboard {
    constructor(container) {
        this.container = container;
        this.listContainer = null;
        this.goalContainer = null;
        this.players = [];
        this.localPlayerId = null;
        this.goalText = '';
        this.sortBy = 'frags'; // 'frags', 'score', 'lines'

        this._initializeDOM();
    }

    /**
     * Initialize DOM references
     */
    _initializeDOM() {
        if (!this.container) return;

        this.listContainer = this.container.querySelector('#scoreboard-list')
            || this.container.querySelector('.scoreboard-list');
        this.goalContainer = this.container.querySelector('#scoreboard-goal')
            || this.container.querySelector('.scoreboard-goal');
    }

    /**
     * Set the local player ID for highlighting
     */
    setLocalPlayer(playerId) {
        this.localPlayerId = playerId;
    }

    /**
     * Set the goal/win condition display
     * @param {string} endCondition - 'frags', 'time', 'points', 'lines'
     * @param {number} value - Target value
     */
    setGoal(endCondition, value) {
        const conditions = {
            frags: `First to ${value} frags`,
            time: `${value} minutes`,
            points: `First to ${value}k points`,
            lines: `First to ${value} lines`,
            never: 'Endless',
        };

        this.goalText = conditions[endCondition] || '';
        this.sortBy = this._getSortField(endCondition);

        if (this.goalContainer) {
            this.goalContainer.textContent = this.goalText;
        }
    }

    /**
     * Get the sort field for a given end condition
     */
    _getSortField(endCondition) {
        if (endCondition === 'points') {
            return 'score';
        }
        if (endCondition === 'lines') {
            return 'lines';
        }
        return 'frags';
    }

    /**
     * Update the player list from network state
     * @param {Array} players - Array of player objects { id, name, frags, score, lines, isAlive }
     */
    updatePlayers(players) {
        if (!players || !Array.isArray(players)) return;

        // Sort by the appropriate metric
        this.players = [...players].sort((a, b) => {
            const aVal = a[this.sortBy] || 0;
            const bVal = b[this.sortBy] || 0;
            return bVal - aVal; // Descending order
        });

        this.render();
    }

    /**
     * Render the scoreboard
     */
    render() {
        if (!this.listContainer) return;

        const html = this.players.map((player, index) => {
            const isLocal = player.id === this.localPlayerId;
            const isDead = player.isAlive === false;

            const classes = ['scoreboard-row'];
            if (isLocal) classes.push('local-player');
            if (isDead) classes.push('dead');

            return `
                <div class="${classes.join(' ')}" data-player-id="${player.id}">
                    <span class="rank">${this._getMedal(index)}</span>
                    <span class="player-name">${this._escapeHtml(player.name)}</span>
                    <span class="frags">${player[this.sortBy] || 0}</span>
                </div>
            `;
        }).join('');

        this.listContainer.innerHTML = html;
    }

    /**
     * Get medal or rank number for a position
     */
    _getMedal(index) {
        switch (index) {
        case 0: return '🥇';
        case 1: return '🥈';
        case 2: return '🥉';
        default: return `${index + 1}.`;
        }
    }

    /**
     * Escape HTML to prevent XSS
     */
    _escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text || '';
        return div.innerHTML;
    }

    /**
     * Highlight a player temporarily (e.g., when they get a kill)
     */
    highlightPlayer(playerId) {
        if (!this.listContainer) return;

        const row = this.listContainer.querySelector(`[data-player-id="${playerId}"]`);
        if (row) {
            row.classList.add('highlight');
            setTimeout(() => row.classList.remove('highlight'), 500);
        }
    }

    /**
     * Clean up
     */
    destroy() {
        this.players = [];
        if (this.listContainer) {
            this.listContainer.innerHTML = '';
        }
    }
}
