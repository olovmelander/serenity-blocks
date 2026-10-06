/**
 * MultiplayerScoreboardOverlay - Fullscreen scoreboard overlay for online multiplayer
 * (Tab). Ranks and labels players by the same rules as the in-game scoreboard
 * (scoreboard-metrics.js): the number that decides the match first.
 */
import { escapeHtml } from '../utils/dom-safety.js';
import {
    METRIC_LABELS,
    compareStandings,
    goalText,
    metricValue,
    playerStatus,
    primaryMetric,
    secondaryMetric,
} from './scoreboard-metrics.js';

export class MultiplayerScoreboardOverlay {
    constructor() {
        this.container = null;
        this.listContainer = null;
        this.goalContainer = null;
        this.players = [];
        this.localPlayerId = null;
        this.goalText = '';
        this.sortBy = 'frags';
        this.playersDirty = false;

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
                    <div class="scoreboard-overlay-row header"></div>
                    <div class="scoreboard-overlay-body"></div>
                </div>
            </div>
        `;

        document.body.appendChild(this.container);

        this.listContainer = this.container.querySelector('.scoreboard-overlay-body');
        this.goalContainer = this.container.querySelector('.scoreboard-overlay-goal');
        this.headerRow = this.container.querySelector('.scoreboard-overlay-row.header');
        this._renderHeader();
    }

    _renderHeader() {
        if (!this.headerRow) return;
        this.headerRow.innerHTML = '<span class="col-rank">#</span><span class="col-name">Player</span>'
            + `<span class="col-primary">${METRIC_LABELS[this.sortBy]}</span>`
            + `<span class="col-secondary">${METRIC_LABELS[secondaryMetric(this.sortBy)]}</span>`
            + '<span class="col-status">Status</span>';
    }

    setLocalPlayer(playerId) {
        this.localPlayerId = playerId;
    }

    setGoal(endCondition, value) {
        this.goalText = goalText(endCondition, value);
        const sortBy = primaryMetric(endCondition);
        if (sortBy !== this.sortBy) {
            this.playersDirty = true;
            this.sortBy = sortBy;
            this._renderHeader();
        }

        if (this.goalContainer) {
            this.goalContainer.textContent = this.goalText;
        }
    }

    updatePlayers(players) {
        if (!players || !Array.isArray(players)) return;

        // Deterministic total order (scoreboard-metrics.js), so tied players never swap
        // on input-order wobble.
        this.players = [...players];
        this.playersDirty = true;
        // Network and RAF feeds continue while Tab's overlay is hidden. Keep the
        // latest state, then sort/build it once when the overlay becomes visible.
        if (this.isVisible()) this.render();
    }

    /** The sort comparator: the shared total order for this match's deciding number. */
    _compare(a, b) {
        return compareStandings(a, b, this.sortBy);
    }

    render() {
        if (!this.listContainer || !this.isVisible()) return;
        if (this.playersDirty) {
            this.players.sort((a, b) => this._compare(a, b));
            this.playersDirty = false;
        }

        // Dirty-check: skip the innerHTML rebuild when nothing rendered changed.
        const sig = this.sortBy + this.players.map((p) => `${p.id}|${p.name}|${p.frags || 0}|${p.score || 0}|`
            + `${p.lines || 0}|${p.isAlive !== false ? 1 : 0}|${p.awaitingSpawn === true ? 1 : 0}|`
            + `${p.id === this.localPlayerId ? 1 : 0}`).join('~');
        if (sig === this._lastRenderSig) return;
        this._lastRenderSig = sig;

        const primary = this.sortBy;
        const secondary = secondaryMetric(primary);
        const html = this.players.map((player, index) => {
            const isLocal = player.id === this.localPlayerId;
            const { label, isDead, isWaiting } = playerStatus(player);

            const classes = ['scoreboard-overlay-row'];
            if (isLocal) classes.push('local-player');
            if (isDead) classes.push('dead');
            if (isWaiting) classes.push('waiting');

            const name = escapeHtml(player.name || '');
            const you = isLocal ? '<span class="col-name__you">You</span>' : '';
            return `
                <div class="${classes.join(' ')}">
                    <span class="col-rank">${index + 1}</span>
                    <span class="col-name" title="${name}">${name}${you}</span>
                    <span class="col-primary">${metricValue(player, primary)}</span>
                    <span class="col-secondary">${metricValue(player, secondary)}</span>
                    <span class="col-status">${label}</span>
                </div>
            `;
        }).join('');

        this.listContainer.innerHTML = html;
    }

    show() {
        if (this.container) {
            this.container.classList.remove('hidden');
            this.render();
        }
    }

    hide() {
        if (this.container) {
            this.container.classList.add('hidden');
        }
    }

    toggle() {
        if (!this.container) return;
        if (this.isVisible()) this.hide();
        else this.show();
    }

    isVisible() {
        return this.container && !this.container.classList.contains('hidden');
    }

    destroy() {
        if (this.container) {
            this.container.remove();
            this.container = null;
        }
        this.listContainer = null;
        this.goalContainer = null;
        this.players = [];
    }
}
