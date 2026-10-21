/**
 * @fileoverview The Stillfall puzzle atlas: the whole pyramid on one page, opened from the
 * panel's Puzzles button, P, or Select on a pad (stillfall-hud.js owns those).
 *
 * - Header: the mode, the puzzles solved of all and the tiers open, and every puzzle as a
 *   cell, tier by tier in its own light, the one on the board in coral.
 * - The descent (left rail, a vertical tab list): the tiers from First light down to the
 *   Core, each with its count and cells, and why a shut tier is shut.
 * - The stage: the selected tier, the card of the selected puzzle (its starting structure as
 *   the art, its lesson, goal and pieces, Play) and the tier's puzzles as a grid of cards,
 *   each with its structure drawn from the bank's data (CSS cells, no canvas, no WebGPU).
 *
 * Focus is the selection. Arrows (D-pad) walk the cards and run on across tiers, Page Up and
 * Page Down (LB, RB) change tier, Enter (A) plays, Escape or P (B, Select) goes back to the
 * board. Space, the drop, does nothing here. A click selects a card; a click on the card
 * already selected plays it.
 * While the atlas is open it hears every key first (window, capture) and nothing under it
 * does, so no key moves or drops the piece; a sheet or the Hub over it takes the keys back.
 * The board keeps rendering underneath an opaque page: no backdrop blur.
 *
 * The model is stillfall-atlas-model.js; the look is public/styles/stillfall.css
 * (#stillfall-atlas).
 */
import {
    balancedColumns,
    buildAtlasModel,
    piecesText,
    preferredPuzzle,
    previewCells,
    puzzleLockNote,
    resolveAtlasKey,
    stepPuzzle,
    stepRow,
    stepTier,
    tierLockNote,
    tierNextNote,
    tierOf,
} from './stillfall-atlas-model.js';
import { goalParts } from '../../core/stillfall/stillfall-puzzle.js';
import { countWord, goalText } from './stillfall-copy.js';

const ROOT_ID = 'stillfall-atlas';
/** The narrowest puzzle card, in rem, unless stillfall.css says otherwise (--atlas-card-min-rem). */
const CARD_MIN_REM = 7.25;
/** A focus this soon after a press came from the pointer: the click decides, not the focus. */
const POINTER_FOCUS_MS = 600;

const LOCK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10.5" width="14" height="10" rx="2.5"/>'
    + '<path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/></svg>';
const CHECK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5.5 12.5l4 4 9-9.5"/></svg>';
const PREV_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 6l-6 6 6 6"/></svg>';
const NEXT_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 6l6 6-6 6"/></svg>';
/** Each piece as it spawns, for the supply on the card. */
const PIECE_ROWS = Object.freeze({
    I: ['####'],
    O: ['##', '##'],
    T: ['.#.', '###'],
    S: ['.##', '##.'],
    Z: ['##.', '.##'],
    J: ['#..', '###'],
    L: ['..#', '###'],
});

const now = () => globalThis.performance?.now?.() ?? Date.now();

function el(tag, className = '', text = '') {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
}

/** A keycap, and the controller button that does the same. */
function keycaps(label, pad) {
    const padCap = pad ? `<kbd class="sb-kbd" data-pad aria-hidden="true">${pad}</kbd>` : '';
    return `<kbd class="sb-kbd" data-key aria-hidden="true">${label}</kbd>${padCap}`;
}

/** The well a puzzle starts from: one cell per square, seams where two bodies meet. */
function wellHtml(definition, className = '') {
    const rows = previewCells(definition);
    const cells = rows.flat().map((cell) => {
        if (!cell) return '<i></i>';
        let classes = `s${cell.shade}`;
        if (cell.relic) classes += ' is-relic';
        if (cell.seal) classes += ' is-seal';
        if (cell.seamRight) classes += ' r';
        if (cell.seamBelow) classes += ' b';
        return `<i class="${classes}"></i>`;
    }).join('');
    const classes = className ? `stillfall-well ${className}` : 'stillfall-well';
    return `<span class="${classes}" style="--well-rows:${rows.length}">${cells}</span>`;
}

function pieceHtml(key) {
    const rows = PIECE_ROWS[key] || PIECE_ROWS.O;
    const cells = rows.join('').split('')
        .map((mark) => (mark === '#' ? '<i class="is-on"></i>' : '<i></i>')).join('');
    return `<span class="stillfall-atlas__piece" style="--piece-cols:${rows[0].length}" title="${key}">${cells}</span>`;
}

/** A header figure: the count, out of the whole, and what it counts. */
function figureHtml(count, whole, label) {
    return `<span class="stillfall-atlas__figure"><b><span data-atlas-figure="${count}">0</span>`
        + `<small> / <span data-atlas-figure="${whole}">0</span></small></b> ${label}</span>`;
}

function shellHtml() {
    return `
        <div class="stillfall-atlas__sky" aria-hidden="true">
            <img class="stillfall-atlas__ambient" src="./assets/menu-art/stillfall.webp" alt="" decoding="async">
        </div>
        <div class="stillfall-atlas__frame">
            <header class="stillfall-atlas__header">
                <div class="stillfall-atlas__brand">
                    <p class="sb-eyebrow stillfall-atlas__eyebrow">Stack · Puzzles</p>
                    <h1 class="stillfall-atlas__title" id="stillfall-atlas-title"><img class="stillfall-atlas__wordmark"
                        src="./assets/branding/modes/stillfall.svg" alt="Stillfall" width="704" height="104"></h1>
                    <p class="stillfall-atlas__lede">Solve three in a tier to open the next.</p>
                </div>
                <div class="stillfall-atlas__journey">
                    <div class="stillfall-atlas__figures">
                        ${figureHtml('solved', 'total', 'Puzzles solved')}
                        ${figureHtml('tiers-open', 'tiers', 'Tiers open')}
                    </div>
                    <div class="stillfall-atlas__meter" aria-hidden="true"></div>
                </div>
                <button type="button" class="sb-btn stillfall-atlas__close" data-atlas-action="close">
                    <span>Back to the puzzle</span>${keycaps('Esc', 'B')}
                </button>
            </header>
            <div class="stillfall-atlas__body">
                <nav class="stillfall-atlas__rail" aria-label="Tiers">
                    <p class="sb-eyebrow sb-eyebrow--quiet stillfall-atlas__rail-label">The descent</p>
                    <ol class="stillfall-atlas__tiers" role="tablist" aria-orientation="vertical"></ol>
                </nav>
                <section class="stillfall-atlas__stage" id="stillfall-atlas-stage" role="tabpanel">
                    <header class="stillfall-atlas__tier-head">
                        <div class="stillfall-atlas__tier-copy">
                            <p class="sb-eyebrow stillfall-atlas__tier-eyebrow" data-atlas-text="tier-eyebrow"></p>
                            <h2 class="stillfall-atlas__tier-title" data-atlas-text="tier-title"></h2>
                            <p class="stillfall-atlas__tier-lede" data-atlas-text="tier-lede"></p>
                        </div>
                        <div class="stillfall-atlas__tier-side">
                            <div class="stillfall-atlas__tier-tally">
                                <span class="stillfall-atlas__tally" data-atlas-text="tier-tally"></span>
                                <span class="stillfall-atlas__tier-note" data-atlas-text="tier-note"></span>
                            </div>
                            <div class="stillfall-atlas__steps">
                                <button type="button" class="stillfall-atlas__step" data-atlas-step="-1"
                                    aria-label="Previous tier">${PREV_SVG}</button>
                                <button type="button" class="stillfall-atlas__step" data-atlas-step="1"
                                    aria-label="Next tier">${NEXT_SVG}</button>
                            </div>
                        </div>
                    </header>
                    <article class="stillfall-atlas__card" aria-labelledby="stillfall-atlas-card-title">
                        <div class="stillfall-atlas__card-art" aria-hidden="true">
                            <span class="stillfall-atlas__halo"></span>
                            <span class="stillfall-atlas__card-well"></span>
                            <span class="stillfall-atlas__card-lock">${LOCK_SVG}</span>
                        </div>
                        <div class="stillfall-atlas__card-copy">
                            <p class="sb-eyebrow stillfall-atlas__card-eyebrow" data-atlas-text="card-eyebrow"></p>
                            <h3 class="stillfall-atlas__card-title" id="stillfall-atlas-card-title"
                                data-atlas-text="card-title"></h3>
                            <p class="stillfall-atlas__card-lesson" data-atlas-text="card-lesson"></p>
                            <p class="stillfall-atlas__card-lock-note" data-atlas-text="card-lock" hidden></p>
                            <div class="stillfall-atlas__card-actions">
                                <button type="button" class="sb-btn sb-btn--primary stillfall-atlas__play"
                                    data-atlas-action="play"><span class="stillfall-atlas__play-label">Play</span>
                                    ${keycaps('Enter', 'A')}</button>
                            </div>
                        </div>
                        <dl class="stillfall-atlas__facts">
                            <div class="stillfall-atlas__fact">
                                <dt>Goal</dt>
                                <dd><span data-atlas-text="card-goal"></span><span class="stillfall-atlas__legend"
                                    data-atlas-legend hidden></span></dd>
                            </div>
                            <div class="stillfall-atlas__fact">
                                <dt>Pieces</dt>
                                <dd class="stillfall-atlas__supply"><span class="stillfall-atlas__pieces" role="img"
                                    data-atlas-pieces></span><span data-atlas-text="card-pieces"></span></dd>
                            </div>
                        </dl>
                    </article>
                    <ol class="stillfall-atlas__grid" data-atlas-grid></ol>
                </section>
            </div>
            <footer class="stillfall-atlas__footer">
                <p class="stillfall-atlas__rule">Every piece can be taken back.</p>
                <ul class="sb-hints stillfall-atlas__hints">
                    <li>${keycaps('←', '◀')}${keycaps('→', '▶')}${keycaps('↑', '▲')}${keycaps('↓', '▼')}Puzzle</li>
                    <li>${keycaps('PgUp', 'LB')}${keycaps('PgDn', 'RB')}Tier</li>
                    <li>${keycaps('Enter', 'A')}Play</li>
                    <li>${keycaps('Esc', 'B')}Back</li>
                </ul>
            </footer>
        </div>`;
}

/** "1, First fall: solved, on the board" */
function spokenPuzzle(puzzle) {
    const parts = [`${puzzle.number}, ${puzzle.title}`];
    let status = 'open';
    if (puzzle.solved) status = 'solved';
    else if (!puzzle.open) status = 'locked';
    parts.push(puzzle.current ? `${status}, on the board` : status);
    return parts.join(': ');
}

function spokenTier(tier) {
    let status = `${tier.solved} of ${tier.puzzles.length} solved`;
    if (!tier.open) status = `locked. ${tierLockNote(tier)}`;
    else if (tier.status === 'complete') status = `all ${tier.puzzles.length} solved`;
    return `${tier.name}, tier ${tier.number}: ${status}${tier.current ? ', on the board' : ''}`;
}

function playLabel(puzzle) {
    if (!puzzle.open) return 'Locked';
    if (puzzle.current) return 'Continue';
    return puzzle.solved ? 'Play again' : 'Play';
}

/** Bring an item into its list's view (either axis) without scrolling anything else. */
function scrollIntoList(item, list) {
    if (!item || !list || typeof item.getBoundingClientRect !== 'function') return;
    const box = list.getBoundingClientRect();
    const at = item.getBoundingClientRect();
    if (at.left < box.left) list.scrollLeft -= box.left - at.left + 8;
    else if (at.right > box.right) list.scrollLeft += at.right - box.right + 36;
    if (at.top < box.top) list.scrollTop -= box.top - at.top + 4;
    else if (at.bottom > box.bottom) list.scrollTop += at.bottom - box.bottom + 4;
}

/** What the atlas draws from a state: the bank's progress and the puzzle on the board. */
function signature(state) {
    const bank = (state?.bank || []).map((entry) => `${entry.open ? 1 : 0}${entry.solved ? 1 : 0}`).join('');
    return `${state?.puzzle?.id}|${bank}`;
}

/** Play a class's entrance again: the layout read between the two class changes restarts it. */
function restartEntrance(node, className) {
    if (!node?.classList) return;
    node.classList.remove(className);
    if (node.offsetWidth >= 0) node.classList.add(className);
}

/**
 * @param {object} options
 * @param {(puzzleId: string) => void} options.onPlay a puzzle other than the one on the board was chosen
 * @param {() => void} options.onClose the atlas closed without a new puzzle (Back, Escape, Continue)
 * @param {() => boolean} [options.isCovered] a sheet or the Hub is over the atlas and owns the keys
 */
export function createStillfallAtlas({ onPlay, onClose, isCovered = () => false } = {}) {
    const view = {
        root: null,
        model: null,
        tier: null,
        selectedId: null,
        open: false,
        returnFocus: null,
        pointerAt: -Infinity,
        shownBeforePress: null,
        columns: 1,
        gridWidth: 0,
        signature: '',
        observer: null,
    };
    const q = (selector) => view.root?.querySelector(selector) || null;
    const setText = (name, text) => {
        const node = q(`[data-atlas-text="${name}"]`);
        if (node) node.textContent = String(text ?? '');
        return node;
    };

    // ---- Header and rail ---------------------------------------------------------------

    function renderHeader() {
        const { model } = view;
        const figure = (name, value) => {
            const node = q(`[data-atlas-figure="${name}"]`);
            if (node) node.textContent = String(value);
        };
        figure('solved', model.solved);
        figure('total', model.total);
        figure('tiers-open', model.tiersOpen);
        figure('tiers', model.tiers.length);
        const meter = q('.stillfall-atlas__meter');
        if (!meter) return;
        meter.replaceChildren(...model.tiers.map((tier) => {
            const group = el('span', 'stillfall-atlas__meter-tier');
            group.dataset.tier = String(tier.tier);
            group.style.flexGrow = String(tier.puzzles.length);
            group.title = tier.name;
            group.innerHTML = tier.puzzles.map((puzzle) => (
                `<i data-state="${puzzle.status}"${puzzle.current ? ' data-current' : ''}></i>`)).join('');
            return group;
        }));
    }

    function tierRow(tier, below) {
        const item = el('li', 'stillfall-atlas__tiers-item');
        item.dataset.tier = String(tier.tier);
        item.setAttribute('role', 'presentation');
        // The line down to the tier below: lit once that tier is open.
        if (below) item.dataset.link = below.open ? 'lit' : 'locked';
        const tab = el('button', 'stillfall-atlas__tier');
        tab.type = 'button';
        tab.id = `stillfall-atlas-tier-${tier.tier}`;
        tab.dataset.tier = String(tier.tier);
        tab.dataset.state = tier.status;
        if (tier.current) tab.dataset.current = '';
        tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-controls', 'stillfall-atlas-stage');
        tab.setAttribute('aria-label', spokenTier(tier));
        const gem = el('span', 'stillfall-atlas__gem', String(tier.number));
        if (!tier.open) gem.insertAdjacentHTML('beforeend', LOCK_SVG);
        const name = el('span', 'stillfall-atlas__tier-line');
        name.appendChild(el('span', 'stillfall-atlas__tier-name', tier.name));
        if (tier.current) name.appendChild(el('span', 'stillfall-atlas__here', 'On the board'));
        const body = el('span', 'stillfall-atlas__tier-body');
        body.appendChild(name);
        if (tier.open) {
            const tally = el('span', 'stillfall-atlas__tier-line');
            const cells = el('span', 'stillfall-atlas__tier-meter');
            cells.innerHTML = tier.puzzles.map((puzzle) => (
                `<i data-state="${puzzle.status}"${puzzle.current ? ' data-current' : ''}></i>`)).join('');
            const count = el('span', 'stillfall-atlas__tier-count');
            count.innerHTML = `${tier.solved}<small>/${tier.puzzles.length}</small>`;
            tally.append(cells, count);
            body.appendChild(tally);
        } else {
            body.appendChild(el('span', 'stillfall-atlas__tier-note', tierLockNote(tier)));
        }
        tab.append(gem, body);
        item.appendChild(tab);
        return item;
    }

    function renderRail() {
        const list = q('.stillfall-atlas__tiers');
        if (!list) return;
        const { tiers } = view.model;
        list.replaceChildren(...tiers.map((tier, index) => tierRow(tier, tiers[index + 1])));
    }

    function markTier() {
        const selected = String(view.tier);
        view.root.querySelectorAll('.stillfall-atlas__tier').forEach((tab) => {
            const isSelected = tab.dataset.tier === selected;
            tab.setAttribute('aria-selected', String(isSelected));
            tab.tabIndex = isSelected ? 0 : -1;
            // In the rail's own scroll box only: the page itself does not move.
            if (isSelected) scrollIntoList(tab, view.root.querySelector('.stillfall-atlas__tiers'));
        });
        view.root.querySelectorAll('.stillfall-atlas__meter-tier').forEach((group) => {
            group.classList.toggle('is-selected', group.dataset.tier === selected);
        });
    }

    // ---- Stage: the tier and its grid --------------------------------------------------

    function renderTierHead(tier) {
        const { tiers } = view.model;
        const index = tiers.indexOf(tier);
        view.root.dataset.tier = String(tier.tier);
        setText('tier-eyebrow', `Tier ${tier.number} of ${tiers.length}${tier.pieces ? ` · ${tier.pieces}` : ''}`);
        setText('tier-title', tier.name);
        setText('tier-lede', tier.lede);
        const tally = q('[data-atlas-text="tier-tally"]');
        if (tally) tally.innerHTML = `<b>${tier.solved}</b>/${tier.puzzles.length} solved`;
        const note = setText('tier-note', tier.open ? tierNextNote(tier, tiers[index + 1]) : tierLockNote(tier));
        if (note) note.dataset.kind = tier.open ? 'next' : 'lock';
        view.root.querySelectorAll('[data-atlas-step]').forEach((button) => {
            button.disabled = !tiers[index + Number(button.dataset.atlasStep)];
        });
        q('.stillfall-atlas__stage')?.setAttribute('aria-labelledby', `stillfall-atlas-tier-${tier.tier}`);
    }

    function puzzleCard(puzzle, index) {
        const item = el('li', 'stillfall-atlas__slot');
        item.style.setProperty('--i', String(index));
        const button = el('button', 'stillfall-atlas__puzzle');
        button.type = 'button';
        button.tabIndex = -1;
        button.dataset.puzzle = puzzle.id;
        button.dataset.state = puzzle.status;
        if (puzzle.current) button.dataset.current = '';
        button.setAttribute('aria-label', spokenPuzzle(puzzle));
        let marks = '';
        if (puzzle.solved) marks += `<span class="stillfall-atlas__solved">${CHECK_SVG}</span>`;
        if (!puzzle.open) marks += `<span class="stillfall-atlas__lock">${LOCK_SVG}</span>`;
        if (puzzle.current) marks += '<span class="stillfall-atlas__flag">On the board</span>';
        button.innerHTML = `<span class="stillfall-atlas__puzzle-art">${wellHtml(puzzle.definition)}${marks}</span>`
            + '<span class="stillfall-atlas__puzzle-line">'
            + `<span class="stillfall-atlas__puzzle-number">${puzzle.number}</span>`
            + '<span class="stillfall-atlas__puzzle-name"></span></span>';
        button.querySelector('.stillfall-atlas__puzzle-name').textContent = puzzle.title;
        item.appendChild(button);
        return item;
    }

    /** Balanced rows (fourteen as seven and seven); the arrows walk the same columns. */
    function layoutGrid() {
        const grid = q('[data-atlas-grid]');
        if (!grid) return;
        const width = grid.clientWidth || 0;
        const style = globalThis.getComputedStyle;
        const rem = parseFloat(style?.(document.documentElement)?.fontSize) || 16;
        const min = parseFloat(style?.(grid)?.getPropertyValue('--atlas-card-min-rem')) || CARD_MIN_REM;
        const gap = 0.75 * rem;
        const fit = width > 0 ? Math.floor((width + gap) / (min * rem + gap)) : grid.children.length;
        view.columns = balancedColumns(grid.children.length, fit);
        grid.style.setProperty('--atlas-columns', String(view.columns));
        view.gridWidth = width;
    }

    function renderGrid(tier) {
        const grid = q('[data-atlas-grid]');
        if (!grid) return;
        grid.setAttribute('aria-label', `Puzzles in ${tier.name}`);
        grid.replaceChildren(...tier.puzzles.map(puzzleCard));
        layoutGrid();
        restartEntrance(grid, 'is-entering');
        if (!view.observer && typeof ResizeObserver === 'function') {
            view.observer = new ResizeObserver(() => {
                if ((q('[data-atlas-grid]')?.clientWidth || 0) !== view.gridWidth) layoutGrid();
            });
            view.observer.observe(grid);
        }
    }

    function markPuzzle() {
        view.root.querySelectorAll('.stillfall-atlas__puzzle').forEach((button) => {
            const isSelected = button.dataset.puzzle === view.selectedId;
            if (isSelected) button.setAttribute('aria-current', 'true');
            else button.removeAttribute('aria-current');
            button.tabIndex = isSelected ? 0 : -1;
        });
    }

    // ---- Stage: the card ---------------------------------------------------------------

    function renderCard(puzzle) {
        const card = q('.stillfall-atlas__card');
        if (!card) return;
        const { model } = view;
        const tier = tierOf(model, puzzle.tier);
        card.dataset.state = puzzle.status;
        if (puzzle.current) card.dataset.current = '';
        else delete card.dataset.current;
        const well = q('.stillfall-atlas__card-well');
        if (well) well.innerHTML = wellHtml(puzzle.definition, 'stillfall-well--large');
        let status = '';
        if (puzzle.current) status = ' · On the board';
        else if (puzzle.solved) status = ' · Solved';
        else if (!puzzle.open) status = ' · Locked';
        setText('card-eyebrow', `Puzzle ${puzzle.number} of ${tier.puzzles.length}${status}`);
        setText('card-title', puzzle.title);
        setText('card-lesson', puzzle.lesson);
        const lock = setText('card-lock', puzzle.open ? '' : puzzleLockNote(model, puzzle));
        if (lock) lock.hidden = puzzle.open;
        setText('card-goal', puzzle.goal ? goalText(puzzle.goal) : '');
        const legend = q('[data-atlas-legend]');
        if (legend) {
            const types = new Set((puzzle.goal ? goalParts(puzzle.goal) : []).map((part) => part.type));
            const marks = [];
            if (types.has('relic-floor')) marks.push('<span><i class="is-relic"></i>The relic</span>');
            if (types.has('seal')) marks.push('<span><i class="is-seal"></i>The seal</span>');
            legend.innerHTML = marks.join('');
            legend.hidden = marks.length === 0;
        }
        const pieces = q('[data-atlas-pieces]');
        if (pieces) pieces.innerHTML = puzzle.supply.map(pieceHtml).join('');
        const count = puzzle.supply.length;
        setText('card-pieces', count > 1 ? `${piecesText([count]).replace(' each', '')}, in this order` : 'One piece');
        pieces?.setAttribute('aria-label', `${countWord(count)}: ${puzzle.supply.join(', ')}`);
        const playButton = q('[data-atlas-action="play"]');
        if (playButton) {
            playButton.disabled = !puzzle.open;
            playButton.dataset.label = playLabel(puzzle).toLowerCase().replace(' ', '-');
            const label = playButton.querySelector('.stillfall-atlas__play-label');
            if (label) label.textContent = playLabel(puzzle);
        }
        restartEntrance(card, 'is-entering');
    }

    // ---- Selection ---------------------------------------------------------------------

    function selectPuzzle(id, { force = false } = {}) {
        const puzzle = view.model?.puzzles.get(id);
        if (!puzzle) return;
        if (puzzle.tier !== view.tier) {
            selectTier(puzzle.tier, puzzle.id);
            return;
        }
        if (!force && view.selectedId === puzzle.id) return;
        view.selectedId = puzzle.id;
        markPuzzle();
        renderCard(puzzle);
    }

    function selectTier(tierNumber, puzzleId = null) {
        const tier = tierOf(view.model, tierNumber) || view.model.tiers[0];
        if (!tier) return;
        const changed = view.tier !== tier.tier;
        view.tier = tier.tier;
        if (changed) {
            renderTierHead(tier);
            renderGrid(tier);
            markTier();
        }
        const target = tier.puzzles.find((puzzle) => puzzle.id === puzzleId) || preferredPuzzle(tier);
        if (target) selectPuzzle(target.id, { force: changed });
    }

    function focusSelected({ scroll = true } = {}) {
        const button = q('.stillfall-atlas__puzzle[aria-current="true"]');
        if (!button) return;
        button.focus({ preventScroll: true });
        if (scroll) button.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    }

    function focusTierTab() {
        q(`#stillfall-atlas-tier-${view.tier}`)?.focus({ preventScroll: true });
    }

    /** Pointer focus is left alone: the click that follows it decides. */
    function moveTo(puzzle) {
        if (!puzzle) return;
        selectPuzzle(puzzle.id);
        focusSelected();
    }

    function stepTierBy(step, { focus = 'card' } = {}) {
        const target = stepTier(view.model, view.tier, step);
        if (!target) return;
        selectTier(target.tier);
        if (focus === 'tab') focusTierTab();
        else if (focus === 'card') focusSelected();
    }

    // ---- Actions -----------------------------------------------------------------------

    function play(puzzleId = view.selectedId) {
        const puzzle = view.model?.puzzles.get(puzzleId);
        if (!view.open || !puzzle?.open) return;
        if (puzzle.current) {
            close();
            return;
        }
        close({ notify: false, restoreFocus: false });
        onPlay?.(puzzle.id);
    }

    // ---- Input -------------------------------------------------------------------------

    function onClick(event) {
        const target = event.target?.closest?.('[data-atlas-action], [data-atlas-step], .stillfall-atlas__tier, '
            + '.stillfall-atlas__meter-tier, .stillfall-atlas__puzzle');
        if (!target || !view.open) return;
        const action = target.dataset.atlasAction;
        if (action === 'close') close();
        else if (action === 'play') play();
        else if (target.dataset.atlasStep) stepTierBy(Number(target.dataset.atlasStep), { focus: 'none' });
        else if (target.dataset.puzzle) {
            const byPointer = event.detail > 0;
            if (!byPointer || view.shownBeforePress === target.dataset.puzzle) play(target.dataset.puzzle);
            else selectPuzzle(target.dataset.puzzle);
        } else if (target.dataset.tier) selectTier(Number(target.dataset.tier));
    }

    function onFocus(event) {
        if (now() - view.pointerAt < POINTER_FOCUS_MS) return;
        const card = event.target?.closest?.('.stillfall-atlas__puzzle');
        if (card) {
            selectPuzzle(card.dataset.puzzle);
            return;
        }
        const tab = event.target?.closest?.('.stillfall-atlas__tier');
        if (tab) selectTier(Number(tab.dataset.tier));
    }

    function focusables() {
        return Array.from(view.root.querySelectorAll('button')).filter((node) => !node.disabled
            && node.tabIndex >= 0 && (typeof node.checkVisibility !== 'function' || node.checkVisibility()));
    }

    function trapTab(event) {
        const list = focusables();
        if (!list.length) return;
        const active = document.activeElement;
        const at = list.indexOf(active);
        let target = null;
        if (at < 0) target = event.shiftKey ? list.at(-1) : list[0];
        else if (event.shiftKey && at === 0) target = list.at(-1);
        else if (!event.shiftKey && at === list.length - 1) [target] = list;
        if (target) {
            event.preventDefault();
            target.focus();
        }
    }

    /** Window, capture: the atlas hears every key first, and nothing under it hears one. */
    function onKeyDown(event) {
        if (!view.open || !view.root?.isConnected || isCovered()) return;
        event.stopPropagation();
        if (event.altKey || event.ctrlKey || event.metaKey) return;
        if (event.key === 'Tab') {
            trapTab(event);
            return;
        }
        if (event.key === 'p' || event.key === 'P') {
            event.preventDefault();
            if (!event.repeat) close();
            return;
        }
        let on = 'other';
        if (event.target?.closest?.('.stillfall-atlas__puzzle')) on = 'card';
        else if (event.target?.closest?.('.stillfall-atlas__tier')) on = 'tab';
        const action = resolveAtlasKey(event.key, on);
        if (!action) return;
        event.preventDefault();
        if ((action.play || action.close) && event.repeat) return;
        if (action.close) close();
        else if (action.play) play();
        else if (action.across) moveTo(stepPuzzle(view.model, view.selectedId, action.across));
        else if (action.row) moveTo(stepRow(view.model, view.selectedId, action.row, view.columns));
        else if (action.tier) stepTierBy(action.tier, { focus: action.focus });
        else if (action.edge) {
            const { puzzles } = tierOf(view.model, view.tier);
            moveTo(action.edge === 'first' ? puzzles[0] : puzzles.at(-1));
        } else if (action.focus === 'card') focusSelected();
    }

    function build() {
        if (view.root?.isConnected) return view.root;
        const root = el('div', 'stillfall-atlas');
        root.id = ROOT_ID;
        root.hidden = true;
        root.setAttribute('role', 'dialog');
        root.setAttribute('aria-modal', 'true');
        root.setAttribute('aria-labelledby', 'stillfall-atlas-title');
        root.innerHTML = shellHtml();
        root.addEventListener('pointerdown', (event) => {
            view.pointerAt = now();
            view.shownBeforePress = event.target?.closest?.('.stillfall-atlas__puzzle') ? view.selectedId : null;
        }, true);
        root.addEventListener('click', onClick);
        root.addEventListener('focusin', onFocus);
        document.body.appendChild(root);
        view.root = root;
        return root;
    }

    function render(state, { keepSelection = false } = {}) {
        const previous = keepSelection ? { tier: view.tier, id: view.selectedId } : null;
        view.model = buildAtlasModel(state);
        renderHeader();
        renderRail();
        view.tier = null;
        view.selectedId = null;
        const id = previous?.id && view.model.puzzles.has(previous.id) ? previous.id : view.model.currentId;
        const puzzle = view.model.puzzles.get(id) || view.model.order[0];
        if (puzzle) selectTier(puzzle.tier, puzzle.id);
    }

    /**
     * Open on the puzzle on the board, with focus on its card.
     * @param {object} state the mode's published state
     * @param {{ returnFocus?: HTMLElement|(() => HTMLElement|null)|null }} [options] where focus goes
     *   back to on Back (a function is asked once the atlas has closed)
     */
    function open(state, { returnFocus = null } = {}) {
        if (typeof document === 'undefined' || !document.body) return;
        build();
        view.returnFocus = returnFocus;
        const wasOpen = view.open;
        view.open = true;
        view.root.hidden = false;
        view.signature = signature(state);
        render(state);
        if (!wasOpen) {
            window.addEventListener('keydown', onKeyDown, true);
            restartEntrance(view.root, 'is-opening');
        }
        const stage = q('.stillfall-atlas__stage');
        if (stage) stage.scrollTop = 0;
        q('.stillfall-atlas__frame')?.scrollTo?.(0, 0);
        layoutGrid();
        focusSelected({ scroll: false });
    }

    /** A new state while open: redrawn only when progress moved; the selection stays. */
    function update(state) {
        if (!view.open || signature(state) === view.signature) return;
        view.signature = signature(state);
        const hadFocus = view.root.contains(document.activeElement)
            && document.activeElement?.classList?.contains('stillfall-atlas__puzzle');
        render(state, { keepSelection: true });
        if (hadFocus) focusSelected({ scroll: false });
    }

    function close({ notify = true, restoreFocus = true } = {}) {
        if (!view.open) return;
        view.open = false;
        window.removeEventListener('keydown', onKeyDown, true);
        const hadFocus = view.root?.contains(document.activeElement);
        if (hadFocus) document.activeElement.blur?.();
        if (view.root) view.root.hidden = true;
        const { returnFocus } = view;
        view.returnFocus = null;
        // The panel re-renders on close, so the control to go back to is looked up after it.
        if (notify) onClose?.();
        const back = typeof returnFocus === 'function' ? returnFocus() : returnFocus;
        if (hadFocus && restoreFocus && back?.isConnected) back.focus({ preventScroll: true });
    }

    return {
        open,
        update,
        close,
        isOpen: () => view.open,
        /** Pad: left and right walk the cards, across tiers. */
        move: (step) => moveTo(stepPuzzle(view.model, view.selectedId, step)),
        /** Pad: up and down walk the rows, on into the tier above or below. */
        moveRow: (step) => moveTo(stepRow(view.model, view.selectedId, step, view.columns)),
        /** Pad: LB and RB. */
        stepTier: (step) => stepTierBy(step),
        /** Pad: A plays the selected puzzle (a shut one stays shut, the open atlas stays). */
        choose: () => play(),
        selectedId: () => view.selectedId,
        dispose() {
            close({ notify: false, restoreFocus: false });
            view.observer?.disconnect?.();
            view.observer = null;
            view.root?.remove();
            view.root = null;
        },
    };
}
