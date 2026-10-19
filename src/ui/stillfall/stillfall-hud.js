/**
 * @fileoverview Stillfall HUD: the panel beside the well while a puzzle is on the board.
 *
 * It shows what StillfallMode publishes on EVENTS.STILLFALL_STATE (the puzzle, its
 * goal and progress, the pieces left, the outcome) and sends the player's undo / restart /
 * hint / next / load back on EVENTS.STILLFALL_COMMAND. It also keeps the solved puzzles
 * in localStorage, so the mode never touches storage. Styles: public/styles/stillfall.css.
 *
 * Keys: Backspace (or Ctrl+Z) takes back a piece, R restarts, ? asks for a hint, Enter
 * goes on after a solve and takes the last piece back after a miss. Gamepad: LB takes back,
 * RB restarts, LT asks for a hint, A does what Enter does. The pad is read here
 * (navigator.getGamepads) while a puzzle is on the board; the gamepad controller keeps the
 * piece controls. Select opens the puzzle list, which then
 * owns the pad (stillfall-pad-list.js): up and down walk it, A plays, B closes.
 */
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { stillfallProgress } from '../../core/stillfall/stillfall-progress.js';
import { SOLVES_TO_OPEN_NEXT_TIER, TIERS, tierName } from '../../core/stillfall/puzzle-bank.js';
import { escapeHtml } from '../../utils/dom-safety.js';
import { csIcon } from '../components/cosmic-icons.js';
import { createPuzzleListPadControls } from './stillfall-pad-list.js';

const SOLVED_KEY = 'serenity.stillfall.solved';
/** Where the solves were kept while the mode was called Fault Lines (until 2026-10-18). */
const LEGACY_SOLVED_KEY = 'serenity.faultLines.solved';
/** Failed attempts on a puzzle before its hint is offered. */
const HINT_AFTER_FAILS = 2;
/** A press right as the cascade settles must not skip the result. */
const NEXT_GRACE_MS = 600;
/** Standard-mapping gamepad buttons (w3c): LB, RB, LT, A. */
const PAD = {
    undo: 4, restart: 5, hint: 6, next: 0,
};
const KEY_LABELS = { ' ': 'Space', Space: 'Space', Backspace: '⌫' };

/** @returns {string[]} the puzzles solved on this device */
export function readSolvedStillfall() {
    try {
        let stored = localStorage.getItem(SOLVED_KEY);
        if (stored === null) {
            stored = localStorage.getItem(LEGACY_SOLVED_KEY);
            if (stored !== null) {
                localStorage.setItem(SOLVED_KEY, stored);
                localStorage.removeItem(LEGACY_SOLVED_KEY);
            }
        }
        const saved = JSON.parse(stored || '[]');
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

const NUMBER_WORDS = ['no', 'one', 'two', 'three'];
/** "the relic", "both relics", "all three relics" */
const theMarked = (count, one, many) => {
    if (count === 1) return `the ${one}`;
    return count === 2 ? `both ${many}` : `all ${NUMBER_WORDS[count] || count} ${many}`;
};
const capitalised = (text) => text.charAt(0).toUpperCase() + text.slice(1);

/** One goal in the panel's words. */
function partText(part) {
    if (part.type === 'waves') return `Set off a cascade ${plural(part.atLeast, 'wave', 'waves')} deep`;
    if (part.type === 'lines') return `Clear ${plural(part.atLeast, 'line', 'lines')}`;
    if (part.type === 'clear-all') return 'Empty the well';
    if (part.type === 'seal') return 'Break the seal';
    return 'Bring the relic to the floor';
}

/** The goal as one sentence: two or three goals are joined, the counts first. */
export function goalText(goal) {
    if (goal.type !== 'all') return partText(goal);
    const relics = goal.of.filter((part) => part.type === 'relic-floor').length;
    const seals = goal.of.filter((part) => part.type === 'seal').length;
    const phrases = goal.of.filter((part) => part.type !== 'relic-floor' && part.type !== 'seal').map(partText);
    if (relics) phrases.push(`bring ${theMarked(relics, 'relic', 'relics')} to the floor`);
    if (seals) phrases.push(`break ${theMarked(seals, 'seal', 'seals')}`);
    const words = phrases.map((phrase) => phrase.charAt(0).toLowerCase() + phrase.slice(1));
    const sentence = words.length > 2 ? `${words.slice(0, -1).join(', ')} and ${words.at(-1)}` : words.join(' and ');
    return capitalised(sentence);
}

const goalPartsOf = (goal) => (goal.type === 'all' ? goal.of : [goal]);
/** The single goals and where each stands; a state without them reads the goal itself. */
const partsOf = (state) => state.parts || goalPartsOf(state.puzzle.goal);

function countRow(label, value, total) {
    const pips = Array.from({ length: total }, (_, i) => (
        `<span class="stillfall-pip${i < value ? ' is-lit' : ''}"></span>`)).join('');
    return `<div class="stillfall-progress" role="img" aria-label="${label}: ${value} of ${total}">
                <span class="stillfall-progress__label">${label}</span>
                <span class="stillfall-pips" aria-hidden="true">${pips}</span>
                <span class="stillfall-progress__count">${value} / ${total}</span>
            </div>`;
}

function blocksRow(label, count) {
    return `<div class="stillfall-progress" role="img" aria-label="${label}: ${count}">
                <span class="stillfall-progress__label">${label}</span>
                <span class="stillfall-progress__count">${count}</span>
            </div>`;
}

/**
 * Pips for a counted goal, the blocks still in the well or in the seals, and the legend
 * for the marks on the board (the relic's diamond, the seal's ring).
 */
function progressHtml(state) {
    const parts = partsOf(state);
    const rows = [];
    for (const part of parts) {
        if (part.type === 'waves') rows.push(countRow('Deepest cascade', state.bestWaves, part.atLeast));
        else if (part.type === 'lines') rows.push(countRow('Lines cleared', state.lines, part.atLeast));
        else if (part.type === 'clear-all') rows.push(blocksRow('Blocks left', state.cellsLeft));
    }
    const relics = parts.filter((part) => part.type === 'relic-floor');
    const seals = parts.filter((part) => part.type === 'seal');
    if (relics.length > 1) rows.push(countRow('On the floor', relics.filter((part) => part.met).length, relics.length));
    if (seals.length > 0 && seals.every((part) => part.cellsLeft !== undefined)) {
        const label = seals.length > 1 ? 'Seal blocks left' : 'Blocks in the seal';
        rows.push(blocksRow(label, seals.reduce((sum, part) => sum + part.cellsLeft, 0)));
    }
    const legend = [];
    if (relics.length) legend.push(`<span class="stillfall-relic" aria-hidden="true"></span> marks ${relics.length > 1 ? 'the relics' : 'the relic'}`);
    if (seals.length) legend.push(`<span class="stillfall-seal" aria-hidden="true"></span> ${legend.length ? '' : 'marks '}${seals.length > 1 ? 'the seals' : 'the seal'}`);
    if (legend.length) rows.push(`<p class="stillfall-hint">${legend.join(', ')}.</p>`);
    return rows.join('');
}

/** Where the supply stands: "Piece 1 of 2", "Last piece", "No pieces left". */
function supplyText(state) {
    const total = state.puzzle.supply.length;
    if (!state.inHand) return 'No pieces left';
    if (state.dealt + 1 === total) return total === 1 ? 'One piece' : 'Last piece';
    return `Piece ${state.dealt + 1} of ${total}`;
}

/**
 * Why the attempt failed, in the goal's own terms. The goal's row above already shows the
 * count, so this says what was missing rather than repeating it.
 */
export function failureTitle(state) {
    const { goal } = state.puzzle;
    const parts = partsOf(state);
    const relics = parts.filter((part) => part.type === 'relic-floor');
    const seals = parts.filter((part) => part.type === 'seal');
    if (state.reason === 'blocked') return 'The next piece has no room.';
    if (state.reason === 'relic-lost') return relics.length > 1 ? 'A relic was cleared away.' : 'The relic was cleared away.';
    // Nothing cleared says it all for a count, or for two goals at once.
    const counted = goal.type === 'waves' || goal.type === 'lines' || goal.type === 'all';
    if (counted && state.lines === 0) return 'Nothing cleared.';
    const messages = [];
    for (const part of parts) {
        if (part.met) continue;
        if (part.type === 'waves' || part.type === 'lines') {
            const short = part.atLeast - (part.type === 'waves' ? state.bestWaves : state.lines);
            const [one, many] = part.type === 'waves' ? ['wave', 'waves'] : ['line', 'lines'];
            if (short > 0) messages.push(`${plural(short, one, many)} short.`);
        } else if (part.type === 'clear-all') {
            messages.push('The well is not empty.');
        }
    }
    // A part with no `met` (a state published without progress) counts as not met.
    const up = relics.filter((part) => !part.met);
    if (up.length === 1) messages.push(relics.length > 1 ? 'A relic is still up.' : 'The relic is still up.');
    else if (up.length > 1) messages.push(`${capitalised(theMarked(up.length, 'relic', 'relics'))} are still up.`);
    const holding = seals.filter((part) => !part.met);
    if (holding.length > 0) {
        const blocks = holding.reduce((sum, part) => sum + (part.cellsLeft ?? 0), 0);
        let who = 'The seals still hold';
        if (holding.length === 1) who = seals.length > 1 ? 'A seal still holds' : 'The seal still holds';
        messages.push(blocks > 0 ? `${who} ${plural(blocks, 'block', 'blocks')}.` : `${who}.`);
    }
    return messages.join(' ') || 'Not yet.';
}

/** The miss's way back, named for what it does: a one-piece puzzle simply starts again. */
function retryHtml(state) {
    const label = state.puzzle.supply.length === 1 ? 'Try again' : 'Take back';
    return `<button type="button" class="sb-btn sb-btn--primary stillfall-retry" data-stillfall-action="retry">
                    <span>${label}</span>${key('Enter')}${pad('A')}
                </button>`;
}

export function outcomeHtml(state) {
    if (state.outcome === 'solved') {
        let next;
        if (state.next) {
            next = `<button type="button" class="sb-btn sb-btn--primary stillfall-next" data-stillfall-action="next">
                    <span>Next puzzle</span>${key('Enter')}${pad('A')}
                </button>`;
        } else if (state.allSolved) {
            next = `<p class="stillfall-hint">All ${state.bank.length} solved. That is every puzzle, for now.</p>`;
        } else {
            next = '<p class="stillfall-hint">Nothing further is open yet.</p>';
        }
        const first = state.firstSolve ? ' <span class="sb-chip sb-chip--gold">First solve</span>' : '';
        return `<div class="stillfall-outcome stillfall-outcome--solved">
                <p class="stillfall-outcome__title">Solved${first}</p>
                ${state.unlockedTier ? `<p class="stillfall-hint">The next tier, ${escapeHtml(state.unlockedTier)}, is open.</p>` : ''}
                ${next}
            </div>`;
    }
    if (state.outcome === 'failed') {
        return `<div class="stillfall-outcome stillfall-outcome--failed">
                <p class="stillfall-outcome__title">${escapeHtml(failureTitle(state))}</p>
                ${retryHtml(state)}
            </div>`;
    }
    if (state.hintShown) {
        // A one-piece puzzle always starts over for its hint; saying so would be noise.
        let note = 'The lit outline is where this piece goes.';
        if (state.hintRestarted && state.puzzle.supply.length > 1) {
            note = 'That board had no way on, so the puzzle starts over. '
                + 'The lit outline is where the first piece goes.';
        }
        return `<div class="stillfall-outcome stillfall-outcome--hint"><p class="stillfall-hint">${note}</p></div>`;
    }
    return '';
}

export function bankHtml(state) {
    const solvedIn = (tier) => state.bank.filter((e) => e.tier === tier && e.solved).length;
    return TIERS.map(({ tier, name }, index) => {
        const entries = state.bank.filter((e) => e.tier === tier);
        if (entries.length === 0) return '';
        // A tier that is not open yet is one line; its puzzles are listed once it opens.
        if (!entries.some((e) => e.open)) {
            const count = plural(entries.length, 'puzzle', 'puzzles');
            return `
        <div class="stillfall-tier is-locked">
            <p class="stillfall-tier__name">${escapeHtml(name)} <span class="stillfall-tier__note">${count} · locked</span></p>
        </div>`;
        }
        const next = TIERS[index + 1];
        const nextOpen = next && entries.some((e) => e.open) && state.bank.some((e) => e.tier === next.tier && e.open);
        let note = `${solvedIn(tier)} of ${entries.length} solved`;
        if (next && !nextOpen) {
            note += ` · ${SOLVES_TO_OPEN_NEXT_TIER - solvedIn(tier)} more to open ${escapeHtml(next.name)}`;
        }
        return `
        <div class="stillfall-tier">
            <p class="stillfall-tier__name">${escapeHtml(name)} <span class="stillfall-tier__note">${note}</span></p>
            <ol class="stillfall-tier__list">${entries.map((entry) => {
        const current = entry.id === state.puzzle.id;
        let mark = entry.open ? '' : '·';
        if (entry.solved) mark = '✓';
        const classes = `stillfall-puzzle${current ? ' is-current' : ''}${entry.solved ? ' is-solved' : ''}${entry.open ? '' : ' is-locked'}`;
        return `<li><button type="button" class="${classes}" data-stillfall-action="load" data-puzzle="${escapeHtml(entry.id)}"
                    ${entry.open ? '' : 'disabled aria-disabled="true"'} ${current ? 'aria-current="true"' : ''}
                    aria-label="${escapeHtml(entry.title)}${entry.solved ? ', solved' : ''}${entry.open ? '' : ', locked'}">
                    <span class="stillfall-puzzle__mark" aria-hidden="true">${mark}</span>
                    <span>${escapeHtml(entry.title)}</span>
                </button></li>`;
    }).join('')}</ol>
        </div>`;
    }).join('');
}

class StillfallHud {
    constructor() {
        this.panel = null;
        this.live = null;
        this.stage = null;
        this.state = null;
        this.listOpen = false;
        /** Failed attempts per puzzle this session; the hint opens after HINT_AFTER_FAILS. */
        this.fails = new Map();
        /** When the latest solve or miss came; a press right at it must not skip the result. */
        this.outcomeAt = 0;
        this.padFrame = null;
        this.padPrev = new Map();
        /** The list's pad owner while a puzzle is on the board, and where the pad is in the list. */
        this.padList = null;
        this.padFocusId = null;
        stillfallProgress.restore(readSolvedStillfall());
        eventBus.on(EVENTS.STILLFALL_STATE, (state) => this.onState(state));
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
        const newOutcome = state.outcome !== 'open' && (!samePuzzle || previous.outcome !== state.outcome);
        if (newOutcome) this.outcomeAt = performance.now();
        if (state.outcome === 'solved') writeSolved(stillfallProgress.solvedIds());
        if (state.outcome === 'failed' && newOutcome) {
            this.fails.set(state.puzzle.id, (this.fails.get(state.puzzle.id) || 0) + 1);
        }
        const newlyOpen = previous ? state.bank.find((e) => e.open && !previousOpen.has(e.id)) : null;
        // The "tier open" note stays through the solved state's re-renders.
        let unlockedTier = null;
        if (newlyOpen) unlockedTier = tierName(newlyOpen.tier);
        else if (samePuzzle && state.outcome === 'solved' && previous.outcome === 'solved') ({ unlockedTier } = previous);
        // The hint is for a piece still to place: not once it is lit, and not after the solve.
        this.state = {
            ...state,
            unlockedTier,
            hintOffered: state.canHint && !state.hintShown && state.outcome !== 'solved'
                && (this.fails.get(state.puzzle.id) || 0) >= HINT_AFTER_FAILS,
        };
        this.render();
        this.announce(previous);
        this.watchPad();
        this.claimPadList();
    }

    mount() {
        if (this.panel?.isConnected) return true;
        this.stage = document.querySelector('.single-player-stage');
        if (!this.stage) return false;
        this.panel = document.createElement('aside');
        this.panel.className = 'stillfall-panel';
        this.panel.setAttribute('aria-label', 'Stillfall puzzle');
        this.panel.addEventListener('click', (event) => this.onClick(event));
        // Space belongs to the board (the drop), never to a focused panel button.
        this.panel.addEventListener('keydown', (event) => {
            if (event.key === ' ' && event.target?.closest?.('button')) {
                event.preventDefault();
                event.target.blur();
            }
        });
        this.live = document.createElement('p');
        this.live.className = 'stillfall-live';
        this.live.setAttribute('aria-live', 'polite');
        this.panel.appendChild(this.live);
        this.content = document.createElement('div');
        this.content.className = 'stillfall-panel__content';
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
        if (this.stage) delete this.stage.dataset.stillfall;
        this.showLedger(true);
        if (this.padFrame) cancelAnimationFrame(this.padFrame);
        this.padFrame = null;
        this.padPrev.clear();
        this.padList?.dispose?.();
        this.padList = null;
        this.padFocusId = null;
    }

    /** The puzzle list on a gamepad: Select opens it, and while open it owns the first pad. */
    claimPadList() {
        const controller = typeof window !== 'undefined' ? window.gamepadController : null;
        if (this.padList || !controller?.setPanelControls) return;
        this.padList = controller.setPanelControls(createPuzzleListPadControls(controller, {
            isActive: () => Boolean(this.state) && !this.covered(),
            isListOpen: () => this.listOpen,
            onOpen: () => {
                this.listOpen = true;
                this.padFocusId = this.state.puzzle.id;
                this.render();
            },
            onMove: (step) => {
                const ids = this.state.bank.filter((entry) => entry.open).map((entry) => entry.id);
                const at = Math.max(0, ids.indexOf(this.padFocusId));
                this.padFocusId = ids[Math.min(ids.length - 1, Math.max(0, at + step))] ?? this.padFocusId;
                this.markPadFocus();
            },
            onChoose: () => {
                const puzzleId = this.padFocusId;
                this.listOpen = false;
                this.render();
                if (puzzleId) this.send('load', { puzzleId });
            },
            onClose: () => {
                this.listOpen = false;
                this.render();
            },
        }));
    }

    markPadFocus() {
        this.content?.querySelectorAll('.stillfall-puzzle.is-pad-focus').forEach((el) => el.classList.remove('is-pad-focus'));
        const button = this.padFocusId
            ? this.content?.querySelector(`.stillfall-puzzle[data-puzzle="${this.padFocusId}"]`)
            : null;
        button?.classList.add('is-pad-focus');
        button?.scrollIntoView?.({ block: 'nearest' });
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
        this.stage.dataset.stillfall = 'on';
        this.showLedger(false);
        const inTier = state.bank.filter((entry) => entry.tier === state.bank.find((e) => e.id === state.puzzle.id)?.tier);
        const position = inTier.findIndex((entry) => entry.id === state.puzzle.id);
        const tier = inTier[0]?.tier;
        const canRestart = state.dealt > 0 || state.outcome !== 'open';
        const firstPuzzle = state.bank[0]?.id === state.puzzle.id && state.dealt === 0 && state.outcome === 'open';
        let hintButton = '';
        if (state.hintOffered) {
            hintButton = `<button type="button" class="sb-btn sb-btn--quiet stillfall-hint-btn" data-stillfall-action="hint">
                    ${csIcon('star', 14, 'btn-icon-svg')}<span>Hint</span>${key('?')}${pad('LT')}
                </button>`;
        }
        this.content.innerHTML = `
            <header class="stillfall-head">
                <p class="stillfall-eyebrow">${escapeHtml(tierName(tier))} · ${position + 1} of ${inTier.length}</p>
                <h2 class="stillfall-title">${escapeHtml(state.puzzle.title)}</h2>
                <p class="stillfall-lesson">${escapeHtml(state.puzzle.lesson)}</p>
            </header>
            <section class="stillfall-goal">
                <p class="stillfall-label">Goal</p>
                <p class="stillfall-goal__text">${escapeHtml(goalText(state.puzzle.goal))}</p>
                ${progressHtml(state)}
                <p class="stillfall-pieces">${supplyText(state)}</p>
                ${firstPuzzle ? `<p class="stillfall-hint">${key(this.dropKeyLabel())}${pad('B')} drops the piece. Nothing locks until you do.</p>` : ''}
            </section>
            ${outcomeHtml(state)}
            <div class="stillfall-actions">
                <button type="button" class="sb-btn sb-btn--quiet" data-stillfall-action="undo"${state.canUndo ? '' : ' disabled'}>
                    ${csIcon('prev', 14, 'btn-icon-svg')}<span>Undo</span>${key('⌫')}${pad('LB')}
                </button>
                <button type="button" class="sb-btn sb-btn--quiet" data-stillfall-action="restart"${canRestart ? '' : ' disabled'}>
                    ${csIcon('cycle', 14, 'btn-icon-svg')}<span>Restart</span>${key('R')}${pad('RB')}
                </button>
                ${hintButton}
                <button type="button" class="sb-btn sb-btn--quiet stillfall-list-btn" data-stillfall-action="list" aria-expanded="${this.listOpen}">
                    ${csIcon('line-stack', 14, 'btn-icon-svg')}<span>Puzzles</span>${pad('Select')}
                </button>
            </div>
            ${this.listOpen ? `<nav class="stillfall-bank" aria-label="Puzzles">${bankHtml(state)}</nav>` : ''}`;
        if (!this.listOpen) this.padFocusId = null;
        else if (this.padFocusId) this.markPadFocus();
        else this.content.querySelector('.stillfall-puzzle.is-current')?.scrollIntoView?.({ block: 'nearest' });
    }

    send(type, extra = {}) {
        eventBus.emit(EVENTS.STILLFALL_COMMAND, { type, ...extra });
    }

    /** Nothing here acts while a sheet (pause, settings, results) or the Hub covers the game. */
    covered() {
        return Boolean(document.querySelector('.modal.visible')) || document.body.classList.contains('serenity-hub-open');
    }

    /** Enter / A: on to the next puzzle after a solve, or the last piece back after a miss. */
    goOn() {
        const { state } = this;
        if (!state || performance.now() - this.outcomeAt < NEXT_GRACE_MS) return false;
        if (state.outcome === 'solved' && state.next) {
            this.send('next');
            return true;
        }
        if (state.outcome === 'failed' && state.canUndo) {
            this.send('undo');
            return true;
        }
        return false;
    }

    onClick(event) {
        const button = event.target.closest?.('[data-stillfall-action]');
        if (!button || button.disabled) return;
        const action = button.dataset.stillfallAction;
        // A pointer click hands the keys back to the board, so Space drops the piece
        // instead of pressing this button again; a keyboard press keeps its place.
        const byPointer = event.detail > 0;
        if (action === 'list') {
            this.listOpen = !this.listOpen;
            this.render();
            if (!byPointer) this.content?.querySelector('[data-stillfall-action="list"]')?.focus();
            return;
        }
        if (action === 'load') {
            this.listOpen = false;
            this.render();
            this.send('load', { puzzleId: button.dataset.puzzle });
            return;
        }
        if (action === 'next' || action === 'retry') {
            this.goOn();
            return;
        }
        this.send(action);
        // The panel re-rendered on the mode's reply: put the keyboard back where it was.
        if (byPointer) document.activeElement?.blur?.();
        else this.content?.querySelector(`[data-stillfall-action="${action}"]`)?.focus();
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
            // The open list owns the pad (stillfall-pad-list.js): its A plays a puzzle.
            if (covered || this.listOpen) continue;
            if (now.undo && !prev.undo) this.send('undo');
            if (now.restart && !prev.restart) this.send('restart');
            if (now.hint && !prev.hint && this.state.hintOffered) this.send('hint');
            if (now.next && !prev.next) this.goOn();
        }
    }
}

let hud = null;

/** Installs the HUD once; it stays idle until Stillfall publishes a puzzle. */
export function installStillfallHud() {
    if (!hud && typeof document !== 'undefined') hud = new StillfallHud();
    return hud;
}
