/**
 * OnlineScoreboard - Right-panel scoreboard for online multiplayer
 *
 * - Ranks players by the number that decides the match (scoreboard-metrics.js) and
 *   shows it first, with the second number beside it when the column has room.
 * - Names get the row's free width; a name too long for it ends in an ellipsis and
 *   reads in full on hover. Your row carries a "You" tag that never hides your name's
 *   start. Every row shows its status: Alive, Out or Waiting.
 * - Shows the goal/win condition and updates in real time from network state.
 *
 * Column widths respond to the info column's width: public/styles/keystone-multiplayer.css
 * (`#online-scoreboard`).
 */
import { escapeHtml } from '../utils/dom-safety.js';
import {
    METRIC_LABELS,
    compareStandings,
    goalText,
    metricIcon,
    metricValue,
    playerStatus,
    primaryMetric,
    secondaryMetric,
} from './scoreboard-metrics.js';

export class OnlineScoreboard {
    constructor(container) {
        this.container = container;
        this.listContainer = null;
        this.goalContainer = null;
        this.headerContainer = null;
        this.players = [];
        this.localPlayerId = null;
        this.goalText = '';
        this.sortBy = 'frags'; // 'frags', 'score', 'lines'

        this._initializeDOM();
    }

    /** The second number each row shows beside the deciding one. */
    get secondaryBy() {
        return secondaryMetric(this.sortBy);
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
        this.headerContainer = this.container.querySelector('.scoreboard-columns-header');
        if (!this.headerContainer) {
            const header = document.createElement('div');
            header.className = 'scoreboard-columns-header';
            // Insert after scoreboard-header
            const titleHeader = this.container.querySelector('.scoreboard-header');
            if (titleHeader) {
                titleHeader.after(header);
            } else if (this.listContainer) {
                this.listContainer.before(header);
            }
            this.headerContainer = header;
        }
        this._renderHeader();
    }

    /** Column heads: the metric columns carry the stat bar's icons, named for every reader. */
    _renderHeader() {
        if (!this.headerContainer) return;
        const metricHead = (column, metric) => {
            const label = METRIC_LABELS[metric];
            return `<span class="${column}" data-metric="${metric}" title="${label}" aria-label="${label}">`
                + `${metricIcon(metric)}</span>`;
        };
        this.headerContainer.innerHTML = `<span class="col-rank">#</span><span class="col-name">Player</span>${
            metricHead('col-primary', this.sortBy)}${metricHead('col-secondary', this.secondaryBy)
        }<span class="col-status">Status</span>`;
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
        this.goalText = goalText(endCondition, value);
        const sortBy = primaryMetric(endCondition);
        if (sortBy !== this.sortBy) {
            this.sortBy = sortBy;
            this.players.sort((a, b) => compareStandings(a, b, this.sortBy));
            this._renderHeader();
            this.render();
        }

        if (this.goalContainer) {
            this.goalContainer.textContent = this.goalText;
        }
    }

    /**
     * Update the player list from network state
     * @param {Array} players - Array of player objects { id, name, frags, score, lines, isAlive }
     */
    updatePlayers(players) {
        if (!players || !Array.isArray(players)) return;

        // A deterministic total order (scoreboard-metrics.js), so equal primary keys can
        // never make rows swap on the input order: the host snapshot's player order
        // wobbles across deltas/resyncs, and early in a match everyone is tied at 0.
        this.players = [...players].sort((a, b) => compareStandings(a, b, this.sortBy));

        this.render();
    }

    /**
     * Render the scoreboard
     */
    render() {
        if (!this.listContainer) return;

        // Dirty-check: skip the full innerHTML rebuild when nothing that affects the
        // rendered rows changed (order, displayed values, status, color, local highlight).
        // The peer feed can fire ~30Hz; rebuilding every time flickers and teleports rows.
        const sig = this.sortBy + this.players.map((p) => `${p.id}|${p.name}|${p.frags || 0}|${p.score || 0}|`
            + `${p.lines || 0}|${p.isAlive !== false ? 1 : 0}|${p.awaitingSpawn === true ? 1 : 0}|${p.color || ''}|`
            + `${p.id === this.localPlayerId ? 1 : 0}`).join('~');
        if (sig === this._lastRenderSig) return;
        this._lastRenderSig = sig;

        const primary = this.sortBy;
        const secondary = this.secondaryBy;
        const html = this.players.map((player, index) => {
            const isLocal = player.id === this.localPlayerId;
            const { label, isDead, isWaiting } = playerStatus(player);

            const classes = ['scoreboard-row'];
            if (isLocal) classes.push('local-player');
            if (isDead) classes.push('dead');
            if (isWaiting) classes.push('waiting');

            const colorStyle = player.color ? `--player-row-color: ${player.color}` : '--player-row-color: #a0aec0';
            const name = escapeHtml(player.name || '');
            const you = isLocal ? '<span class="col-name__you">You</span>' : '';

            return `
                <div class="${classes.join(' ')}" data-player-id="${escapeHtml(player.id)}"
                    data-rank="${index + 1}" style="${colorStyle}">
                    <span class="col-rank">${index + 1}</span>
                    <span class="col-name" title="${name}"><span class="col-name__text">${name}</span>${you}</span>
                    <span class="col-primary" data-metric="${primary}">${metricValue(player, primary)}</span>
                    <span class="col-secondary" data-metric="${secondary}">${metricValue(player, secondary)}</span>
                    <span class="col-status">${label}</span>
                </div>
            `;
        }).join('');

        this.listContainer.innerHTML = html;
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
