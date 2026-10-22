/**
 * @fileoverview Stillfall HUD: the panel beside the well while a puzzle is on the board.
 *
 * It shows what StillfallMode publishes on EVENTS.STILLFALL_STATE (the puzzle, its
 * goal and progress, the pieces left, the outcome) and sends the player's undo / restart /
 * hint / next / load back on EVENTS.STILLFALL_COMMAND. It also keeps the solved puzzles
 * in localStorage, so the mode never touches storage. Styles: public/styles/stillfall.css.
 *
 * Keys: Backspace (or Ctrl+Z) takes back a piece, R restarts, ? asks for a hint, Enter
 * goes on after a solve and takes the last piece back after a miss, P opens the puzzle
 * atlas. Gamepad: LB takes back, RB restarts, LT asks for a hint, A does what Enter does.
 * The pad is read here (navigator.getGamepads) while a puzzle is on the board; the gamepad
 * controller keeps the piece controls.
 *
 * The Puzzles button, P and Select open the atlas (stillfall-atlas.js), the whole pyramid
 * on one page. While it is open it owns the keys and the first pad (stillfall-pad-list.js):
 * the D-pad walks the puzzles, LB and RB the tiers, A plays, B or Select closes.
 */
import { eventBus, EVENTS } from '../../events/event-bus.js';
import { stillfallProgress } from '../../core/stillfall/stillfall-progress.js';
import { tierName } from '../../core/stillfall/puzzle-bank.js';
import { escapeHtml } from '../../utils/dom-safety.js';
import { csIcon } from '../components/cosmic-icons.js';
import {
    capitalised, goalText, plural, theMarked,
} from './stillfall-copy.js';
import { createPuzzleListPadControls } from './stillfall-pad-list.js';
import { pieceGlyphHtml } from './stillfall-piece-glyphs.js';
import { NEXT_QUEUE_SLOTS } from '../next-queue-ui.js';

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

const key = (label) => `<kbd class="sb-kbd" data-key aria-hidden="true">${escapeHtml(label)}</kbd>`;
const pad = (label) => `<kbd class="sb-kbd" data-pad aria-hidden="true">${label}</kbd>`;

/** The goal as one sentence (stillfall-copy.js; the atlas uses it too). */
export { goalText };

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
 * The whole supply, when it is longer than the queue beside the well shows (the piece in hand
 * and NEXT_QUEUE_SLOTS more): each piece as it spawns, the ones placed dimmed and the one in
 * hand lit, so a five-piece puzzle can be planned from its first piece. Shorter supplies leave
 * it to the queue.
 */
export function supplyStripHtml(state) {
    const { supply } = state.puzzle;
    if (supply.length <= NEXT_QUEUE_SLOTS + 1) return '';
    const glyphs = supply.map((piece, index) => {
        let place = 'is-coming';
        if (index < state.dealt) place = 'is-placed';
        else if (index === state.dealt && state.inHand) place = 'is-in-hand';
        return pieceGlyphHtml(piece, 'stillfall-supply__piece', place);
    }).join('');
    const label = `The pieces, in order: ${supply.join(', ')}`;
    return `<span class="stillfall-supply" role="img" aria-label="${label}">${glyphs}</span>`;
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

/**
 * The atlas, fetched once Stillfall shows its first puzzle rather than at boot: the main menu
 * imports this module for the puzzle counts, and the atlas is a whole page of its own. Until it
 * lands it is shut and keeps the latest state; an open asked for meanwhile happens on arrival.
 */
function createLazyAtlas(options, { onOpened } = {}) {
    let atlas = null;
    let loading = null;
    let latest = null;
    let pendingOpen = null;
    const load = () => {
        if (!loading) {
            loading = import('./stillfall-atlas.js').then(({ createStillfallAtlas }) => {
                atlas = createStillfallAtlas(options);
                if (latest) atlas.update(latest);
                if (pendingOpen) {
                    const { state, openOptions } = pendingOpen;
                    pendingOpen = null;
                    atlas.open(state, openOptions);
                    onOpened?.();
                }
                return atlas;
            }).catch((error) => {
                loading = null;
                console.warn('[Stillfall] The puzzle atlas could not load:', error?.message || error);
            });
        }
        return loading;
    };
    return {
        load,
        update(state) {
            latest = state;
            atlas?.update(state);
        },
        isOpen: () => Boolean(atlas?.isOpen()),
        open(state, openOptions) {
            if (atlas) {
                atlas.open(state, openOptions);
                return;
            }
            pendingOpen = { state, openOptions };
            load();
        },
        close(closeOptions) {
            pendingOpen = null;
            atlas?.close(closeOptions);
        },
        move: (step) => atlas?.move(step),
        moveRow: (step) => atlas?.moveRow(step),
        stepTier: (step) => atlas?.stepTier(step),
        choose: () => atlas?.choose(),
    };
}

class StillfallHud {
    constructor() {
        this.panel = null;
        this.live = null;
        this.stage = null;
        this.state = null;
        /** The puzzle atlas (stillfall-atlas.js): the whole pyramid, over the board. */
        this.atlas = createLazyAtlas({
            onPlay: (puzzleId) => {
                this.render();
                this.send('load', { puzzleId });
            },
            onClose: () => this.render(),
            isCovered: () => this.covered(),
        }, { onOpened: () => this.render() });
        /** Failed attempts per puzzle this session; the hint opens after HINT_AFTER_FAILS. */
        this.fails = new Map();
        /** When the latest solve or miss came; a press right at it must not skip the result. */
        this.outcomeAt = 0;
        this.padFrame = null;
        this.padPrev = new Map();
        /** The atlas's pad owner while a puzzle is on the board. */
        this.padList = null;
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
        this.atlas.load();
        this.atlas.update(this.state);
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

    get listOpen() {
        return this.atlas.isOpen();
    }

    /** Opens the atlas on the puzzle on the board; Back hands focus to `returnFocus`. */
    openAtlas({ returnFocus = null } = {}) {
        if (!this.state) return;
        this.atlas.open(this.state, { returnFocus });
        this.render();
    }

    hide() {
        this.state = null;
        this.atlas.close({ notify: false, restoreFocus: false });
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
    }

    /** The atlas on a gamepad: Select opens it, and while open it owns the first pad. */
    claimPadList() {
        const controller = typeof window !== 'undefined' ? window.gamepadController : null;
        if (this.padList || !controller?.setPanelControls) return;
        this.padList = controller.setPanelControls(createPuzzleListPadControls(controller, {
            isActive: () => Boolean(this.state) && !this.covered(),
            isListOpen: () => this.atlas.isOpen(),
            onOpen: () => this.openAtlas(),
            onMove: (step) => this.atlas.moveRow(step),
            onMoveAcross: (step) => this.atlas.move(step),
            onTier: (step) => this.atlas.stepTier(step),
            onChoose: () => this.atlas.choose(),
            onClose: () => this.atlas.close({ restoreFocus: false }),
        }));
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
                ${supplyStripHtml(state)}
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
                <button type="button" class="sb-btn sb-btn--quiet stillfall-list-btn" data-stillfall-action="list"
                    aria-haspopup="dialog" aria-controls="stillfall-atlas" aria-expanded="${this.listOpen}">
                    ${csIcon('line-stack', 14, 'btn-icon-svg')}<span>Puzzles</span>${key('P')}${pad('Select')}
                </button>
            </div>`;
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
            // Back from the atlas returns a keyboard user to this button; a pointer, to the board.
            this.openAtlas({
                returnFocus: byPointer ? null : () => this.content?.querySelector('[data-stillfall-action="list"]'),
            });
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
        } else if (event.key === 'p' || event.key === 'P') {
            event.preventDefault();
            this.openAtlas();
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
            // The open atlas owns the pad (stillfall-pad-list.js): its A plays a puzzle.
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
