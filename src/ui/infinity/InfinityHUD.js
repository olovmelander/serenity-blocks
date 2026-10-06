/**
 * @fileoverview Infinity's HUD (InfinityMode): the climb at a glance, beside the well.
 *
 * - Height: the rows built so far, a bar toward the next milestone with the rows left,
 *   and the milestones themselves (a tenth, a quarter, half, three quarters and all of
 *   the ceiling: 100 … 1,000 rows), passed ones in gold, the next one lit.
 * - This climb: the score, the blocks placed and the lines cleared.
 * - Its best: the biggest cascade, the most lines from one piece, the longest chain, and
 *   how many cascades went off.
 * - While a cascade chains (×2 and up), a callout over the board counts it.
 *
 * The mode owns the game and calls update(gameState); this module owns the DOM. Keystone
 * styles: public/styles/keystone-solo.css. The tower map beside the well is
 * InfinityMinimap.js.
 */

import { calculateBuildHeight } from '../../core/infinity-grid.js';

/** Milestones as shares of the ceiling. */
const MILESTONE_SHARES = [0.1, 0.25, 0.5, 0.75, 1];
const CASCADE_MS = 1500;

const rows = (n) => `${n.toLocaleString()} ${n === 1 ? 'row' : 'rows'}`;

/** Rows built (the shared helper counts an empty board as one row; here it is none). */
function buildHeight(gameState, board) {
    const height = calculateBuildHeight(gameState);
    return height === 1 && !board?.[board.length - 1]?.some(Boolean) ? 0 : height;
}

export class InfinityHUD {
    constructor() {
        this.container = null;
        this.gameState = null;
        this.cascadeCounter = null;
        this.cascadeTimeout = null;
        this.activeCascadeCount = 0;
        this.achievedMilestones = new Set();
        this.milestones = [];
        // Last values written, so unchanged numbers never touch the DOM.
        this._last = {};
        this._initialize();
    }

    /** @private */
    _initialize() {
        this.container = document.createElement('div');
        this.container.id = 'infinity-hud';
        this.container.className = 'infinity-hud';
        this.container.style.display = 'none';
        this.container.setAttribute('role', 'region');
        this.container.setAttribute('aria-label', 'Infinity: the climb');
        this.container.innerHTML = `
            <div class="ih-kicker"><span class="ih-kicker__mark" aria-hidden="true"></span>Infinity</div>
            <section class="ih-climb">
                <div class="ih-label">Height</div>
                <div class="ih-height"><span class="ih-height__value" data-ih="height">0</span>
                    <span class="ih-height__unit" data-ih="unit">rows</span></div>
                <div class="ih-next">
                    <div class="ih-next__track" aria-hidden="true">
                        <span class="ih-next__fill" data-ih="fill"></span></div>
                    <div class="ih-next__caption" data-ih="caption"></div>
                </div>
                <ol class="ih-milestones" data-ih="milestones" aria-label="Milestones"></ol>
                <div class="ih-ceiling"><span>Ceiling</span><span data-ih="ceiling">—</span></div>
            </section>
            <section class="ih-session">
                <div class="ih-score"><span class="ih-label">Score</span>
                    <span class="ih-score__value" id="stat-score">0</span></div>
                <div class="ih-pair">
                    <div class="ih-stat"><span class="ih-label">Blocks</span>
                        <span class="ih-stat__value" id="stat-blocks">0</span></div>
                    <div class="ih-stat"><span class="ih-label">Lines</span>
                        <span class="ih-stat__value" id="stat-lines">0</span></div>
                </div>
            </section>
            <section class="ih-best">
                <div class="ih-label ih-label--gold">Best of this climb</div>
                <div class="ih-pair">
                    <div class="ih-stat"><span class="ih-label">Biggest cascade</span>
                        <span class="ih-stat__value" id="stat-max-cascade-score">0</span></div>
                    <div class="ih-stat"><span class="ih-label">Lines, one piece</span>
                        <span class="ih-stat__value" id="stat-max-lines">0</span></div>
                    <div class="ih-stat"><span class="ih-label">Longest chain</span>
                        <span class="ih-stat__value" id="stat-max-cascade">0</span></div>
                    <div class="ih-stat"><span class="ih-label">Cascades</span>
                        <span class="ih-stat__value" id="stat-total-cascades">0</span></div>
                </div>
            </section>`;
        const part = (name) => this.container.querySelector(`[data-ih="${name}"]`);
        this.heightDisplay = part('height');
        this.rowUnit = part('unit');
        this.progressBar = part('fill');
        this.progressText = part('caption');
        this.milestonesDisplay = part('milestones');
        this.topRowDisplay = part('ceiling');
        const stat = (id) => this.container.querySelector(`#${id}`);
        this.stats = {
            score: stat('stat-score'),
            blocks: stat('stat-blocks'),
            lines: stat('stat-lines'),
            maxCascadeScore: stat('stat-max-cascade-score'),
            maxLines: stat('stat-max-lines'),
            maxChain: stat('stat-max-cascade'),
            cascades: stat('stat-total-cascades'),
        };

        this.cascadeCounter = document.createElement('div');
        this.cascadeCounter.className = 'cascade-counter-overlay';
        this.cascadeCounter.setAttribute('role', 'status');
        document.body.appendChild(this.cascadeCounter);
    }

    /** Builds the milestone pips for a ceiling. */
    _layoutMilestones(maxRows) {
        if (this._last.milestoneCeiling === maxRows) return;
        this._last.milestoneCeiling = maxRows;
        this.milestones = [...new Set(MILESTONE_SHARES.map((share) => Math.max(1, Math.round(maxRows * share))))];
        this.milestonesDisplay.innerHTML = this.milestones
            .map((m) => `<li class="ih-milestone" data-milestone="${m}">${m.toLocaleString()}</li>`)
            .join('');
        this._last.milestoneState = null;
    }

    show() {
        const panel = document.getElementById('single-player-container');
        if (panel && this.container.parentElement !== panel) panel.appendChild(this.container);
        this.container.style.display = '';
    }

    hide() {
        this.container.style.display = 'none';
    }

    /**
     * @param {Object} gameState
     */
    update(gameState) {
        if (!gameState) return;
        this.gameState = gameState;
        const maxRows = gameState.maxRows || 1000;
        this._layoutMilestones(maxRows);
        // The height only changes with the board (its version, or a new grid).
        const board = gameState.board || gameState.boardGrid;
        const version = gameState.boardVersion;
        const fresh = version !== undefined && this._last.board === board && this._last.version === version;
        const height = fresh ? this._last.height : buildHeight(gameState, board);
        this._last.board = board;
        this._last.version = version;
        if (!fresh || this._last.maxRows !== maxRows) {
            this._last.height = height;
            this._last.maxRows = maxRows;
            this._updateClimb(height, maxRows);
        }
        this._updateStatistics();
    }

    /** Height, the way to the next milestone, the milestones and the ceiling. */
    _updateClimb(height, maxRows) {
        this.heightDisplay.textContent = height.toLocaleString();
        this.rowUnit.textContent = height === 1 ? 'row' : 'rows';
        const next = this.milestones.find((m) => height < m);
        const previous = [...this.milestones].reverse().find((m) => height >= m) || 0;
        if (next) {
            const share = (height - previous) / (next - previous);
            this.progressBar.style.setProperty('--ih-progress', String(Math.min(1, Math.max(0, share))));
            this.progressText.textContent = `${rows(next - height)} to ${next.toLocaleString()}`;
        } else {
            this.progressBar.style.setProperty('--ih-progress', '1');
            this.progressText.textContent = 'At the ceiling';
        }
        this.topRowDisplay.textContent = rows(Math.max(0, maxRows - height));

        const state = this.milestones.map((m) => {
            if (height >= m) return 'passed';
            return m === next ? 'next' : 'future';
        }).join();
        if (state === this._last.milestoneState) return;
        this._last.milestoneState = state;
        this.milestonesDisplay.querySelectorAll('.ih-milestone').forEach((pip) => {
            const m = Number(pip.dataset.milestone);
            const passed = height >= m;
            pip.classList.toggle('is-passed', passed);
            pip.classList.toggle('is-next', m === next);
            if (passed && !this.achievedMilestones.has(m)) {
                this.achievedMilestones.add(m);
                pip.classList.add('is-new');
            }
        });
    }

    /** Writes a number only when it changed (formatting it then, not every frame). */
    _write(key, element, value) {
        const n = Number(value) || 0;
        if (!element || this._last[key] === n) return;
        this._last[key] = n;
        element.textContent = n.toLocaleString();
    }

    /** The session and its best, from the state's own counters. */
    _updateStatistics() {
        const state = this.gameState;
        const infinity = state.infinityStats || {};
        this._write('score', this.stats.score, state.score);
        this._write('lines', this.stats.lines, state.lines);
        this._write('blocks', this.stats.blocks, infinity.blocksPlaced);
        this._write('maxCascadeScore', this.stats.maxCascadeScore, infinity.maxCascadeScore);
        this._write('maxLines', this.stats.maxLines, infinity.maxComboDepth);
        this._write('maxChain', this.stats.maxChain, infinity.maxComboComplexity);
        this._write('cascades', this.stats.cascades, infinity.totalCascades);
    }

    /**
     * Counts a chaining cascade over the board (×2 and up).
     * @param {number} cascadeCount
     */
    updateCascadeCounter(cascadeCount) {
        if (!this.cascadeCounter) return;
        this.activeCascadeCount = cascadeCount;
        if (cascadeCount < 2) return;
        this.cascadeCounter.innerHTML = '<span class="cascade-counter-overlay__kicker">Cascade</span>'
            + `<span class="cascade-counter-overlay__count">×${cascadeCount}</span>`;
        this.cascadeCounter.classList.toggle('is-big', cascadeCount >= 10);
        this.cascadeCounter.classList.add('is-shown');
        clearTimeout(this.cascadeTimeout);
        this.cascadeTimeout = setTimeout(() => this.hideCascadeCounter(), CASCADE_MS);
    }

    hideCascadeCounter() {
        if (!this.cascadeCounter) return;
        this.cascadeCounter.classList.remove('is-shown');
        this.activeCascadeCount = 0;
    }

    destroy() {
        clearTimeout(this.cascadeTimeout);
        this.cascadeCounter?.remove();
        this.cascadeCounter = null;
        this.container?.remove();
    }
}
