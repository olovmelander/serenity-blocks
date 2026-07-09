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

        // Inject column header if not present
        if (!this.container.querySelector('.scoreboard-columns-header')) {
            const header = document.createElement('div');
            header.className = 'scoreboard-columns-header';
            header.innerHTML = `
                <span class="col-rank">#</span>
                <span class="col-name">Player</span>
                <span class="col-frags">Frags</span>
                <span class="col-score">Score</span>
                <span class="col-status">Status</span>
            `;
            // Insert after scoreboard-header
            const titleHeader = this.container.querySelector('.scoreboard-header');
            if (titleHeader) {
                titleHeader.after(header);
            } else if (this.listContainer) {
                this.listContainer.before(header);
            }
        }
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

        // Sort by a DETERMINISTIC total order so equal primary keys can never make
        // rows swap based on the input array order (the host snapshot's player order
        // wobbles across deltas/resyncs, and early-game everyone is tied at 0). Primary
        // metric desc → frags → score → lines → stable id tiebreak.
        this.players = [...players].sort((a, b) => this._compare(a, b));

        this.render();
    }

    /**
     * Total-order comparator: primary metric, then frags/score/lines, then a stable id
     * tiebreak. Fully determined by values + id → independent of input array order.
     */
    _compare(a, b) {
        const primary = (b[this.sortBy] || 0) - (a[this.sortBy] || 0);
        if (primary) return primary;
        if ((b.frags || 0) !== (a.frags || 0)) return (b.frags || 0) - (a.frags || 0);
        if ((b.score || 0) !== (a.score || 0)) return (b.score || 0) - (a.score || 0);
        if ((b.lines || 0) !== (a.lines || 0)) return (b.lines || 0) - (a.lines || 0);
        return String(a.id ?? '').localeCompare(String(b.id ?? ''));
    }

    /**
     * Render the scoreboard
     */
    render() {
        if (!this.listContainer) return;

        // Dirty-check: skip the full innerHTML rebuild when nothing that affects the
        // rendered rows changed (order, displayed values, status, color, local highlight).
        // The peer feed can fire ~30Hz; rebuilding every time flickers and teleports rows.
        const sig = this.players.map((p) => `${p.id}|${p.name}|${p.frags || 0}|${p.score || 0}|`
            + `${p.lines || 0}|${p.isAlive !== false ? 1 : 0}|${p.awaitingSpawn === true ? 1 : 0}|${p.color || ''}|${p.id === this.localPlayerId ? 1 : 0}`).join('~');
        if (sig === this._lastRenderSig) return;
        this._lastRenderSig = sig;

        const html = this.players.map((player, index) => {
            const isLocal = player.id === this.localPlayerId;
            // A late joiner waiting to spawn is isAlive:false but NOT eliminated.
            const isWaiting = player.awaitingSpawn === true;
            const isDead = player.isAlive === false && !isWaiting;
            let status = 'Alive';
            if (isWaiting) status = 'Waiting';
            else if (isDead) status = 'Dead';

            const classes = ['scoreboard-row'];
            if (isLocal) classes.push('local-player');
            if (isDead) classes.push('dead');
            if (isWaiting) classes.push('waiting');

            const colorStyle = player.color ? `--player-row-color: ${player.color}` : '--player-row-color: #a0aec0';

            return `
                <div class="${classes.join(' ')}" data-player-id="${player.id}" style="${colorStyle}">
                    <span class="col-rank">${this._getMedal(index)}</span>
                    <span class="col-name">${this._escapeHtml(player.name)}</span>
                    <span class="col-frags">${player.frags || 0}</span>
                    <span class="col-score">${(player.score || 0).toLocaleString()}</span>
                    <span class="col-status">${status}</span>
                </div>
            `;
        }).join('');

        this.listContainer.innerHTML = html;
    }

    /**
     * Get medal or rank number for a position
     */
    _getMedal(index) {
        const trophySvg = (color) => `<svg viewBox="0 0 24 24" width="1.2em" height="1.2em" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-0.2em"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg>`;
        switch (index) {
        case 0: return trophySvg('#FFF480');
        case 1: return trophySvg('#E2E8F0');
        case 2: return trophySvg('#CD7F32');
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
        this._lastRenderSig = null;
        if (this.listContainer) {
            this.listContainer.innerHTML = '';
        }
    }
}
