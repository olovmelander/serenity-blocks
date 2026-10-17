/**
 * @fileoverview Fault Lines HUD: the panel beside the well while a puzzle is on the board.
 *
 * It shows what FaultLinesMode publishes on EVENTS.FAULT_LINES_STATE (the puzzle, its
 * goal and progress, the pieces left, the outcome) and sends the player's undo / restart /
 * hint / next / load back on EVENTS.FAULT_LINES_COMMAND. It also keeps the solved puzzles
 * in localStorage, so the mode never touches storage. Styles: public/styles/fault-lines.css.
 *
 * Keys: Backspace (or Ctrl+Z) takes back a piece, R restarts, ? asks for a hint, Enter
 * goes on after a solve. Gamepad: LB takes back, RB restarts, LT asks for a hint, A goes
 * on. The pad is read here (navigator.getGamepads) while a puzzle is on the board; the
 * gamepad controller keeps the piece controls.
 */
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { faultLinesProgress } from '../../core/fault-lines/fault-lines-progress.js';
import { SOLVES_TO_OPEN_NEXT_TIER, TIERS, tierName } from '../../core/fault-lines/puzzle-bank.js';
import { escapeHtml } from '../../utils/dom-safety.js';
import { csIcon } from '../components/cosmic-icons.js';

const SOLVED_KEY = 'serenity.faultLines.solved';
/** Failed attempts on a puzzle before its hint is offered. */
const HINT_AFTER_FAILS = 2;
/** A press right as the cascade solves must not skip the result. */
const NEXT_GRACE_MS = 600;
/** Standard-mapping gamepad buttons (w3c): LB, RB, LT, A. */
const PAD = {
    undo: 4, restart: 5, hint: 6, next: 0,
};
const KEY_LABELS = { ' ': 'Space', Space: 'Space', Backspace: '⌫' };

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
const key = (label) => `<kbd class="sb-kbd" data-key aria-hidden="true">${escapeHtml(label)}</kbd>`;
const pad = (label) => `<kbd class="sb-kbd" data-pad aria-hidden="true">${label}</kbd>`;

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
        return `<div class="fl-progress" role="img" aria-label="${label}: ${value} of ${goal.atLeast}">
                <span class="fl-progress__label">${label}</span>
                <span class="fl-pips" aria-hidden="true">${pips}</span>
                <span class="fl-progress__count">${value} / ${goal.atLeast}</span>
            </div>`;
    }
    const hint = goal.type === 'relic-floor'
        ? '<span class="fl-relic" aria-hidden="true"></span> marks the relic.'
        : `Every block must go. ${plural(state.cellsLeft, 'remains', 'remain')}.`;
    return `<p class="fl-hint">${hint}</p>`;
}

/** Where the supply stands: "Piece 1 of 2", "Last piece", "No pieces left". */
function supplyText(state) {
    const total = state.puzzle.supply.length;
    if (!state.inHand) return 'No pieces left';
    if (state.dealt + 1 === total) return total === 1 ? 'One piece' : 'Last piece';
    return `Piece ${state.dealt + 1} of ${total}`;
}

/** Why the attempt failed, in the goal's own terms. */
function failureTitle(state) {
    const { goal } = state.puzzle;
    if (state.reason === 'blocked') return 'The next piece has no room.';
    if (state.reason === 'relic-lost') return 'The relic was cleared away.';
    if (goal.type === 'waves') {
        return state.bestWaves === 0 ? 'Nothing cleared.' : `The cascade reached ${state.bestWaves} of ${goal.atLeast} waves.`;
    }
    if (goal.type === 'lines') return `${state.lines} of ${goal.atLeast} lines cleared.`;
    if (goal.type === 'clear-all') return `${plural(state.cellsLeft, 'block remains', 'blocks remain')}.`;
    return 'The relic is still up.';
}

function outcomeHtml(state) {
    if (state.outcome === 'solved') {
        let next;
        if (state.next) {
            next = `<button type="button" class="sb-btn sb-btn--primary fl-next" data-fl="next">
                    <span>Next puzzle</span>${key('Enter')}${pad('A')}
                </button>`;
        } else if (state.allSolved) {
            next = `<p class="fl-hint">All ${state.bank.length} solved. That is every puzzle, for now.</p>`;
        } else {
            next = '<p class="fl-hint">Nothing further is open yet.</p>';
        }
        const first = state.firstSolve ? ' <span class="sb-chip sb-chip--gold">First solve</span>' : '';
        return `<div class="fl-outcome fl-outcome--solved">
                <p class="fl-outcome__title">Solved${first}</p>
                ${state.unlockedTier ? `<p class="fl-hint">The next tier, ${escapeHtml(state.unlockedTier)}, is open.</p>` : ''}
                ${next}
            </div>`;
    }
    if (state.outcome === 'failed') {
        return `<div class="fl-outcome fl-outcome--failed">
                <p class="fl-outcome__title">${escapeHtml(failureTitle(state))}</p>
                <p class="fl-hint">Take a piece back, or start again.</p>
            </div>`;
    }
    if (state.hintShown) {
        const note = state.hintRestarted
            ? 'No way on from there, so the puzzle started over. The first piece is lit.'
            : 'The lit outline is where this piece goes.';
        return `<div class="fl-outcome fl-outcome--hint"><p class="fl-hint">${note}</p></div>`;
    }
    return '';
}

function bankHtml(state) {
    const solvedIn = (tier) => state.bank.filter((e) => e.tier === tier && e.solved).length;
    return TIERS.map(({ tier, name }, index) => {
        const entries = state.bank.filter((e) => e.tier === tier);
        if (entries.length === 0) return '';
        const next = TIERS[index + 1];
        const nextOpen = next && entries.some((e) => e.open) && state.bank.some((e) => e.tier === next.tier && e.open);
        let note = `${solvedIn(tier)} of ${entries.length} solved`;
        if (next && !nextOpen && entries.some((e) => e.open)) {
            note += ` · ${SOLVES_TO_OPEN_NEXT_TIER} open ${escapeHtml(next.name)}`;
        }
        return `
        <div class="fl-tier">
            <p class="fl-tier__name">${escapeHtml(name)} <span class="fl-tier__note">${note}</span></p>
            <ol class="fl-tier__list">${entries.map((entry) => {
        const current = entry.id === state.puzzle.id;
        let mark = entry.open ? '' : '·';
        if (entry.solved) mark = '✓';
        const classes = `fl-puzzle${current ? ' is-current' : ''}${entry.solved ? ' is-solved' : ''}${entry.open ? '' : ' is-locked'}`;
        return `<li><button type="button" class="${classes}" data-fl="load" data-puzzle="${escapeHtml(entry.id)}"
                    ${entry.open ? '' : 'disabled aria-disabled="true"'} ${current ? 'aria-current="true"' : ''}
                    aria-label="${escapeHtml(entry.title)}${entry.solved ? ', solved' : ''}${entry.open ? '' : ', locked'}">
                    <span class="fl-puzzle__mark" aria-hidden="true">${mark}</span>
                    <span>${escapeHtml(entry.title)}</span>
                </button></li>`;
    }).join('')}</ol>
        </div>`;
    }).join('');
}

class FaultLinesHud {
    constructor() {
        this.panel = null;
        this.live = null;
        this.stage = null;
        this.state = null;
        this.listOpen = false;
        /** Failed attempts per puzzle this session; the hint opens after HINT_AFTER_FAILS. */
        this.fails = new Map();
        this.solvedAt = 0;
        this.padFrame = null;
        this.padPrev = new Map();
        faultLinesProgress.restore(readSolvedFaultLines());
        eventBus.on(EVENTS.FAULT_LINES_STATE, (state) => this.onState(state));
        document.addEventListener('keydown', (event) => this.onKeyDown(event));
    }

    onState(state) {
        if (!state?.active) {
            this.hide();
            return;
        }
        const previous = this.state;
        const samePuzzle = previous?.puzzle.id === state.puzzle.id;
        const previousOpen = new Set((previous?.bank || []).filter((e) => e.open).map((e) => e.id));
        if (state.outcome === 'solved') {
            writeSolved(faultLinesProgress.solvedIds());
            if (!samePuzzle || previous.outcome !== 'solved') this.solvedAt = performance.now();
        }
        if (state.outcome === 'failed' && (!samePuzzle || previous.outcome !== 'failed')) {
            this.fails.set(state.puzzle.id, (this.fails.get(state.puzzle.id) || 0) + 1);
        }
        const newlyOpen = previous ? state.bank.find((e) => e.open && !previousOpen.has(e.id)) : null;
        // The "tier open" note stays through the solved state's re-renders.
        let unlockedTier = null;
        if (newlyOpen) unlockedTier = tierName(newlyOpen.tier);
        else if (samePuzzle && state.outcome === 'solved' && previous.outcome === 'solved') ({ unlockedTier } = previous);
        this.state = {
            ...state,
            unlockedTier,
            hintOffered: state.canHint && (this.fails.get(state.puzzle.id) || 0) >= HINT_AFTER_FAILS,
        };
        this.render();
        this.announce(previous);
        this.watchPad();
    }

    mount() {
        if (this.panel?.isConnected) return true;
        this.stage = document.querySelector('.single-player-stage');
        if (!this.stage) return false;
        this.panel = document.createElement('aside');
        this.panel.className = 'fl-panel';
        this.panel.setAttribute('aria-label', 'Fault Lines puzzle');
        this.panel.addEventListener('click', (event) => this.onClick(event));
        // Space belongs to the board (the drop), never to a focused panel button.
        this.panel.addEventListener('keydown', (event) => {
            if (event.key === ' ' && event.target?.closest?.('button')) {
                event.preventDefault();
                event.target.blur();
            }
        });
        this.live = document.createElement('p');
        this.live.className = 'fl-live';
        this.live.setAttribute('aria-live', 'polite');
        this.panel.appendChild(this.live);
        this.content = document.createElement('div');
        this.content.className = 'fl-panel__content';
        this.panel.appendChild(this.content);
        this.stage.appendChild(this.panel);
        return true;
    }

    hide() {
        this.state = null;
        this.listOpen = false;
        this.panel?.remove();
        this.panel = null;
        this.live = null;
        this.content = null;
        if (this.stage) delete this.stage.dataset.faultLines;
        this.showLedger(true);
        if (this.padFrame) cancelAnimationFrame(this.padFrame);
        this.padFrame = null;
        this.padPrev.clear();
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

    /** One persistent live region, so a screen reader hears each outcome once. */
    announce(previous) {
        const { state, live } = this;
        if (!state || !live) return;
        const changed = !previous || previous.puzzle.id !== state.puzzle.id || previous.outcome !== state.outcome;
        if (!changed) return;
        let text = '';
        if (state.outcome === 'solved') text = `${state.puzzle.title} solved.`;
        else if (state.outcome === 'failed') text = failureTitle(state);
        else if (!previous || previous.puzzle.id !== state.puzzle.id) {
            text = `${state.puzzle.title}. ${goalText(state.puzzle.goal)}.`;
        }
        live.textContent = text;
    }

    dropKeyLabel() {
        const bound = window.settingsManager?.get?.()?.keyBindings?.hardDrop || 'Space';
        return KEY_LABELS[bound] || (bound.length === 1 ? bound.toUpperCase() : bound);
    }

    render() {
        const { state } = this;
        if (!state || !this.mount()) return;
        this.stage.dataset.faultLines = 'on';
        this.showLedger(false);
        const inTier = state.bank.filter((entry) => entry.tier === state.bank.find((e) => e.id === state.puzzle.id)?.tier);
        const position = inTier.findIndex((entry) => entry.id === state.puzzle.id);
        const tier = inTier[0]?.tier;
        const canRestart = state.dealt > 0 || state.outcome !== 'open';
        const firstPuzzle = state.bank[0]?.id === state.puzzle.id && state.dealt === 0 && state.outcome === 'open';
        let hintButton = '';
        if (state.hintOffered) {
            hintButton = `<button type="button" class="sb-btn sb-btn--quiet fl-hint-btn" data-fl="hint"${state.hintShown ? ' disabled' : ''}>
                    ${csIcon('star', 14, 'btn-icon-svg')}<span>${state.hintShown ? 'Hint shown' : 'Hint'}</span>${key('?')}${pad('LT')}
                </button>`;
        }
        this.content.innerHTML = `
            <header class="fl-head">
                <p class="fl-eyebrow">${escapeHtml(tierName(tier))} · ${position + 1} of ${inTier.length}</p>
                <h2 class="fl-title">${escapeHtml(state.puzzle.title)}</h2>
                <p class="fl-lesson">${escapeHtml(state.puzzle.lesson)}</p>
            </header>
            <section class="fl-goal">
                <p class="fl-label">Goal</p>
                <p class="fl-goal__text">${escapeHtml(goalText(state.puzzle.goal))}</p>
                ${progressHtml(state)}
                <p class="fl-pieces">${supplyText(state)}</p>
                ${firstPuzzle ? `<p class="fl-hint">${key(this.dropKeyLabel())}${pad('B')} drops the piece. Nothing locks until you do.</p>` : ''}
            </section>
            ${outcomeHtml(state)}
            <div class="fl-actions">
                <button type="button" class="sb-btn sb-btn--quiet" data-fl="undo"${state.canUndo ? '' : ' disabled'}>
                    ${csIcon('prev', 14, 'btn-icon-svg')}<span>Undo</span>${key('⌫')}${pad('LB')}
                </button>
                <button type="button" class="sb-btn sb-btn--quiet" data-fl="restart"${canRestart ? '' : ' disabled'}>
                    ${csIcon('cycle', 14, 'btn-icon-svg')}<span>Restart</span>${key('R')}${pad('RB')}
                </button>
                ${hintButton}
                <button type="button" class="sb-btn sb-btn--quiet fl-list-btn" data-fl="list" aria-expanded="${this.listOpen}">
                    ${csIcon('line-stack', 14, 'btn-icon-svg')}<span>Puzzles</span>
                </button>
            </div>
            ${this.listOpen ? `<nav class="fl-bank" aria-label="Puzzles">${bankHtml(state)}</nav>` : ''}`;
        if (this.listOpen) {
            this.content.querySelector('.fl-puzzle.is-current')?.scrollIntoView?.({ block: 'nearest' });
        }
    }

    send(type, extra = {}) {
        eventBus.emit(EVENTS.FAULT_LINES_COMMAND, { type, ...extra });
    }

    /** Nothing here acts while a sheet (pause, settings, results) or the Hub covers the game. */
    covered() {
        return Boolean(document.querySelector('.modal.visible')) || document.body.classList.contains('serenity-hub-open');
    }

    goOn() {
        if (this.state?.outcome === 'solved' && this.state.next && performance.now() - this.solvedAt >= NEXT_GRACE_MS) {
            this.send('next');
            return true;
        }
        return false;
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
            if (!byPointer) this.content?.querySelector('[data-fl="list"]')?.focus();
            return;
        }
        if (action === 'load') {
            this.listOpen = false;
            this.render();
            this.send('load', { puzzleId: button.dataset.puzzle });
            return;
        }
        if (action === 'next') {
            this.goOn();
            return;
        }
        this.send(action);
        // The panel re-rendered on the mode's reply: put the keyboard back where it was.
        if (byPointer) document.activeElement?.blur?.();
        else this.content?.querySelector(`[data-fl="${action}"]`)?.focus();
    }

    onKeyDown(event) {
        if (!this.state || event.defaultPrevented || event.repeat || event.altKey) return;
        if (this.covered()) return;
        const tag = event.target?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        if (event.ctrlKey || event.metaKey) {
            if (event.key === 'z' || event.key === 'Z') {
                event.preventDefault();
                this.send('undo');
            }
            return;
        }
        // A key the player bound to a move, or to a Serenity action (H opens the Hub), keeps it.
        const settings = window.settingsManager?.get?.() || {};
        const bound = [...Object.values(settings.keyBindings || {}), ...Object.values(settings.serenityKeyBindings || {})];
        if (bound.some((boundKey) => String(boundKey).toLowerCase() === event.key.toLowerCase())) return;
        if (event.key === 'Backspace') {
            event.preventDefault();
            this.send('undo');
        } else if (event.key === 'r' || event.key === 'R') {
            this.send('restart');
        } else if (event.key === '?' && this.state.hintOffered) {
            this.send('hint');
        } else if (event.key === 'Enter' && !event.target?.closest?.('button')) {
            if (this.goOn()) event.preventDefault();
        }
    }

    /** Polls the pad once a frame while a puzzle is on the board (edge-triggered). */
    watchPad() {
        if (this.padFrame || typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return;
        const tick = () => {
            this.padFrame = null;
            if (!this.state) return;
            this.pollPad();
            this.padFrame = requestAnimationFrame(tick);
        };
        this.padFrame = requestAnimationFrame(tick);
    }

    pollPad() {
        let pads;
        try {
            pads = navigator.getGamepads();
        } catch {
            return;
        }
        const covered = this.covered();
        for (const gamepad of pads || []) {
            if (!gamepad) continue;
            const now = {};
            Object.entries(PAD).forEach(([action, index]) => { now[action] = Boolean(gamepad.buttons[index]?.pressed); });
            const prev = this.padPrev.get(gamepad.index) || {};
            this.padPrev.set(gamepad.index, now);
            if (covered) continue;
            if (now.undo && !prev.undo) this.send('undo');
            if (now.restart && !prev.restart) this.send('restart');
            if (now.hint && !prev.hint && this.state.hintOffered) this.send('hint');
            if (now.next && !prev.next) this.goOn();
        }
    }
}

let hud = null;

/** Installs the HUD once; it stays idle until Fault Lines publishes a puzzle. */
export function installFaultLinesHud() {
    if (!hud && typeof document !== 'undefined') hud = new FaultLinesHud();
    return hud;
}
