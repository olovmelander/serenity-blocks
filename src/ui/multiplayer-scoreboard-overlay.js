/**
 * MultiplayerScoreboardOverlay - Fullscreen scoreboard overlay for online multiplayer
 */
export class MultiplayerScoreboardOverlay {
    constructor() {
        this.container = null;
        this.listContainer = null;
        this.goalContainer = null;
        this.players = [];
        this.localPlayerId = null;
        this.goalText = '';
        this.sortBy = 'frags';

        this.createUI();
    }

    createUI() {
        this.container = document.createElement('div');
        this.container.id = 'multiplayer-scoreboard-overlay';
        this.container.className = 'scoreboard-overlay hidden';

        this.container.innerHTML = `
            <div class="scoreboard-overlay-panel">
                <div class="scoreboard-overlay-header">
                    <span class="scoreboard-overlay-title">Scoreboard</span>
                    <span class="scoreboard-overlay-goal"></span>
                </div>
                <div class="scoreboard-overlay-table">
                    <div class="scoreboard-overlay-row header">
                        <span class="col-rank">#</span>
                        <span class="col-name">Player</span>
                        <span class="col-frags">Frags</span>
                        <span class="col-score">Score</span>
                        <span class="col-status">Status</span>
                    </div>
                    <div class="scoreboard-overlay-body"></div>
                </div>
            </div>
        `;

        document.body.appendChild(this.container);

        this.listContainer = this.container.querySelector('.scoreboard-overlay-body');
        this.goalContainer = this.container.querySelector('.scoreboard-overlay-goal');
    }

    setLocalPlayer(playerId) {
        this.localPlayerId = playerId;
    }

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

    _getSortField(endCondition) {
        if (endCondition === 'points') {
            return 'score';
        }
        if (endCondition === 'lines') {
            return 'lines';
        }
        return 'frags';
    }

    updatePlayers(players) {
        if (!players || !Array.isArray(players)) return;

        this.players = [...players].sort((a, b) => {
            const aVal = a[this.sortBy] || 0;
            const bVal = b[this.sortBy] || 0;
            return bVal - aVal;
        });

        this.render();
    }

    render() {
        if (!this.listContainer) return;

        const html = this.players.map((player, index) => {
            const isLocal = player.id === this.localPlayerId;
            const isDead = player.isAlive === false;
            const status = isDead ? 'Dead' : 'Alive';

            const classes = ['scoreboard-overlay-row'];
            if (isLocal) classes.push('local-player');
            if (isDead) classes.push('dead');

            return `
                <div class="${classes.join(' ')}">
                    <span class="col-rank">${index + 1}</span>
                    <span class="col-name">${this._escapeHtml(player.name)}</span>
                    <span class="col-frags">${player.frags || 0}</span>
                    <span class="col-score">${player.score || 0}</span>
                    <span class="col-status">${status}</span>
                </div>
            `;
        }).join('');

        this.listContainer.innerHTML = html;
    }

    show() {
        if (this.container) {
            this.container.classList.remove('hidden');
        }
    }

    hide() {
        if (this.container) {
            this.container.classList.add('hidden');
        }
    }

    toggle() {
        if (!this.container) return;
        this.container.classList.toggle('hidden');
    }

    isVisible() {
        return this.container && !this.container.classList.contains('hidden');
    }

    destroy() {
        if (this.container) {
            this.container.remove();
            this.container = null;
        }
    }

    _escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text || '';
        return div.innerHTML;
    }
}
