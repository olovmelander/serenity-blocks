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

        // Deterministic total order (see OnlineScoreboard): primary metric → frags →
        // score → lines → stable id, so tied players never swap on input-order wobble.
        this.players = [...players].sort((a, b) => this._compare(a, b));

        this.render();
    }

    _compare(a, b) {
        const primary = (b[this.sortBy] || 0) - (a[this.sortBy] || 0);
        if (primary) return primary;
        if ((b.frags || 0) !== (a.frags || 0)) return (b.frags || 0) - (a.frags || 0);
        if ((b.score || 0) !== (a.score || 0)) return (b.score || 0) - (a.score || 0);
        if ((b.lines || 0) !== (a.lines || 0)) return (b.lines || 0) - (a.lines || 0);
        return String(a.id ?? '').localeCompare(String(b.id ?? ''));
    }

    render() {
        if (!this.listContainer) return;

        // Dirty-check: skip the innerHTML rebuild when nothing rendered changed.
        const sig = this.players.map((p) => `${p.id}|${p.name}|${p.frags || 0}|${p.score || 0}|`
            + `${p.lines || 0}|${p.isAlive !== false ? 1 : 0}|${p.awaitingSpawn === true ? 1 : 0}|${p.id === this.localPlayerId ? 1 : 0}`).join('~');
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

            const classes = ['scoreboard-overlay-row'];
            if (isLocal) classes.push('local-player');
            if (isDead) classes.push('dead');
            if (isWaiting) classes.push('waiting');

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
