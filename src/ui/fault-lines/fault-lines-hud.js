/**
 * @fileoverview Fault Lines HUD: the panel beside the well while a puzzle is on the board.
 *
 * It shows what FaultLinesMode publishes on EVENTS.FAULT_LINES_STATE (the puzzle, its
 * goal and progress, the pieces left, the outcome) and sends the player's undo / restart /
 * next / load back on EVENTS.FAULT_LINES_COMMAND. It also keeps the solved puzzles in
 * localStorage, so the mode never touches storage. Styles: public/styles/fault-lines.css.
 *
 * Keys: Backspace takes back a piece, R restarts, Enter goes on after a solve.
 */
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { faultLinesProgress } from '../../core/fault-lines/fault-lines-progress.js';
import { escapeHtml } from '../../utils/dom-safety.js';
import { csIcon } from '../components/cosmic-icons.js';

const SOLVED_KEY = 'serenity.faultLines.solved';
const TIER_NAMES = { 1: 'First light', 2: 'Two pieces', 3: 'Deep fault' };

/** @returns {string[]} the puzzles solved on this device */
export function readSolvedFaultLines() {
    try {
        const saved = JSON.parse(localStorage.getItem(SOLVED_KEY) || '[]');
        return Array.isArray(saved) ? saved.filter((id) => typeof id === 'string') : [];
    } catch {
        return [];
    }
}

function writeSolved(ids) {
    try {
        localStorage.setItem(SOLVED_KEY, JSON.stringify(ids));
    } catch { /* storage blocked: the solve still counts for this session */ }
}

const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

function goalText(goal) {
    if (goal.type === 'waves') return `Set off a cascade ${plural(goal.atLeast, 'wave', 'waves')} deep`;
    if (goal.type === 'lines') return `Clear ${plural(goal.atLeast, 'line', 'lines')}`;
    if (goal.type === 'clear-all') return 'Empty the well';
    return 'Bring the relic to the floor';
}

/** Pips for a counted goal, or a sentence for the others. */
function progressHtml(state) {
    const { goal } = state.puzzle;
    if (goal.type === 'waves' || goal.type === 'lines') {
        const value = goal.type === 'waves' ? state.bestWaves : state.lines;
        const pips = Array.from({ length: goal.atLeast }, (_, i) => (
            `<span class="fl-pip${i < value ? ' is-lit' : ''}"></span>`)).join('');
        const label = goal.type === 'waves' ? 'Deepest cascade' : 'Lines cleared';
        return `<div class="fl-progress" aria-label="${label}: ${value} of ${goal.atLeast}">
                <span class="fl-progress__label">${label}</span>
                <span class="fl-pips" aria-hidden="true">${pips}</span>
            </div>`;
    }
    const hint = goal.type === 'relic-floor'
        ? '<span class="fl-relic" aria-hidden="true"></span> marks the relic.'
        : 'Every block must go.';
    return `<p class="fl-hint">${hint}</p>`;
}

function outcomeHtml(state) {
    if (state.outcome === 'solved') {
        const next = state.next
            ? `<button type="button" class="sb-btn sb-btn--primary fl-next" data-fl="next">
                    <span>Next puzzle</span><kbd class="sb-kbd" data-key aria-hidden="true">Enter</kbd>
                </button>`
            : '<p class="fl-hint">That is every open puzzle. Solve more below to open the next tier.</p>';
        return `<div class="fl-outcome fl-outcome--solved" role="status">
                <p class="fl-outcome__title">Solved${state.firstSolve ? ' <span class="sb-chip sb-chip--gold">New</span>' : ''}</p>
                ${state.unlockedTier ? `<p class="fl-hint">${escapeHtml(state.unlockedTier)} is open.</p>` : ''}
                ${next}
            </div>`;
    }
    if (state.outcome === 'failed') {
        const why = state.remaining.length === 0 && state.dealt > 0 ? 'Out of pieces.' : 'No room to deal the next piece.';
        return `<div class="fl-outcome fl-outcome--failed" role="status">
                <p class="fl-outcome__title">${why}</p>
                <p class="fl-hint">Take a piece back, or start again.</p>
            </div>`;
    }
    return '';
}

function bankHtml(state) {
    const tiers = new Map();
    state.bank.forEach((entry) => {
        if (!tiers.has(entry.tier)) tiers.set(entry.tier, []);
        tiers.get(entry.tier).push(entry);
    });
    return [...tiers.entries()].map(([tier, entries]) => `
        <div class="fl-tier">
            <p class="fl-tier__name">${escapeHtml(TIER_NAMES[tier] || `Tier ${tier}`)}</p>
            <ol class="fl-tier__list">${entries.map((entry) => {
        const current = entry.id === state.puzzle.id;
        let mark = entry.open ? '' : '·';
        if (entry.solved) mark = '✓';
        return `<li><button type="button" class="fl-puzzle${current ? ' is-current' : ''}${entry.solved ? ' is-solved' : ''}"
                    data-fl="load" data-puzzle="${escapeHtml(entry.id)}"${entry.open ? '' : ' disabled aria-disabled="true"'}
                    ${current ? 'aria-current="true"' : ''}>
                    <span class="fl-puzzle__mark" aria-hidden="true">${mark}</span>
                    <span>${escapeHtml(entry.open ? entry.title : 'Locked')}</span>
                </button></li>`;
    }).join('')}</ol>
        </div>`).join('');
}

class FaultLinesHud {
    constructor() {
        this.panel = null;
        this.stage = null;
        this.state = null;
        this.listOpen = false;
        faultLinesProgress.restore(readSolvedFaultLines());
        eventBus.on(EVENTS.FAULT_LINES_STATE, (state) => this.onState(state));
        document.addEventListener('keydown', (event) => this.onKeyDown(event));
    }

    onState(state) {
        if (!state?.active) {
            this.hide();
            return;
        }
        const previousOpen = new Set((this.state?.bank || []).filter((e) => e.open).map((e) => e.id));
        if (state.outcome === 'solved') writeSolved(faultLinesProgress.solvedIds());
        const newlyOpen = this.state ? state.bank.find((e) => e.open && !previousOpen.has(e.id)) : null;
        this.state = {
            ...state,
            unlockedTier: newlyOpen ? (TIER_NAMES[newlyOpen.tier] || `Tier ${newlyOpen.tier}`) : null,
        };
        this.render();
    }

    mount() {
        if (this.panel?.isConnected) return true;
        this.stage = document.querySelector('.single-player-stage');
        if (!this.stage) return false;
        this.panel = document.createElement('aside');
        this.panel.className = 'fl-panel';
        this.panel.setAttribute('aria-label', 'Fault Lines puzzle');
        this.panel.addEventListener('click', (event) => this.onClick(event));
        this.stage.appendChild(this.panel);
        return true;
    }

    hide() {
        this.state = null;
        this.listOpen = false;
        this.panel?.remove();
        this.panel = null;
        if (this.stage) delete this.stage.dataset.faultLines;
        this.showLedger(true);
    }

    /**
     * Single Player's ledger (score, level) means nothing in a puzzle. Its display is set
     * inline with !important when the mode activates, so it is hidden the same way.
     */
    showLedger(visible) {
        const ledger = this.stage?.querySelector('.single-player-stats-bar');
        if (!ledger) return;
        if (visible) {
            ledger.style.removeProperty('display');
            ledger.removeAttribute('aria-hidden');
        } else {
            ledger.style.setProperty('display', 'none', 'important');
            ledger.setAttribute('aria-hidden', 'true');
        }
    }

    render() {
        const { state } = this;
        if (!state || !this.mount()) return;
        this.stage.dataset.faultLines = 'on';
        this.showLedger(false);
        const position = state.bank.findIndex((entry) => entry.id === state.puzzle.id);
        const tier = state.bank[position]?.tier;
        const left = state.remaining.length;
        this.panel.innerHTML = `
            <header class="fl-head">
                <p class="fl-eyebrow">${escapeHtml(TIER_NAMES[tier] || 'Fault Lines')} · ${position + 1} of ${state.bank.length}</p>
                <h2 class="fl-title">${escapeHtml(state.puzzle.title)}</h2>
                <p class="fl-lesson">${escapeHtml(state.puzzle.lesson)}</p>
            </header>
            <section class="fl-goal">
                <p class="fl-label">Goal</p>
                <p class="fl-goal__text">${escapeHtml(goalText(state.puzzle.goal))}</p>
                ${progressHtml(state)}
                <p class="fl-pieces">${left > 0 ? `${plural(left, 'piece', 'pieces')} left` : 'No pieces left'}</p>
            </section>
            ${outcomeHtml(state)}
            <div class="fl-actions">
                <button type="button" class="sb-btn sb-btn--quiet" data-fl="undo"${state.canUndo ? '' : ' disabled'}>
                    ${csIcon('prev', 14, 'btn-icon-svg')}<span>Undo</span><kbd class="sb-kbd" data-key aria-hidden="true">⌫</kbd>
                </button>
                <button type="button" class="sb-btn sb-btn--quiet" data-fl="restart"${state.dealt > 0 || state.outcome !== 'open' ? '' : ' disabled'}>
                    ${csIcon('cycle', 14, 'btn-icon-svg')}<span>Restart</span><kbd class="sb-kbd" data-key aria-hidden="true">R</kbd>
                </button>
                <button type="button" class="sb-btn sb-btn--quiet" data-fl="list" aria-expanded="${this.listOpen}">
                    ${csIcon('line-stack', 14, 'btn-icon-svg')}<span>Puzzles</span>
                </button>
            </div>
            ${this.listOpen ? `<nav class="fl-bank" aria-label="Puzzles">${bankHtml(state)}</nav>` : ''}`;
    }

    send(type, extra = {}) {
        eventBus.emit(EVENTS.FAULT_LINES_COMMAND, { type, ...extra });
    }

    onClick(event) {
        const button = event.target.closest?.('[data-fl]');
        if (!button || button.disabled) return;
        const action = button.dataset.fl;
        // A pointer click hands the keys back to the board, so Space drops the piece
        // instead of pressing this button again; a keyboard press keeps its place.
        const byPointer = event.detail > 0;
        if (action === 'list') {
            this.listOpen = !this.listOpen;
            this.render();
            if (!byPointer) this.panel?.querySelector('[data-fl="list"]')?.focus();
            return;
        }
        if (action === 'load') {
            this.listOpen = false;
            this.send('load', { puzzleId: button.dataset.puzzle });
            return;
        }
        this.send(action);
        if (byPointer) button.blur();
    }

    onKeyDown(event) {
        if (!this.state || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
        if (document.querySelector('.modal.visible')) return; // pause, settings, results
        const tag = event.target?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        // A key the player bound to a move stays that move.
        const bindings = window.settingsManager?.get?.()?.keyBindings || {};
        if (Object.values(bindings).some((key) => String(key).toLowerCase() === event.key.toLowerCase())) return;
        if (event.key === 'Backspace') {
            event.preventDefault();
            this.send('undo');
        } else if (event.key === 'r' || event.key === 'R') {
            this.send('restart');
        } else if (event.key === 'Enter' && this.state.outcome === 'solved' && this.state.next
            && !event.target?.closest?.('button')) {
            event.preventDefault();
            this.send('next');
        }
    }
}

let hud = null;

/** Installs the HUD once; it stays idle until Fault Lines publishes a puzzle. */
export function installFaultLinesHud() {
    if (!hud && typeof document !== 'undefined') hud = new FaultLinesHud();
    return hud;
}
