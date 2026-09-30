/**
 * Parhelion board-rect reader (THEME_SPEC §7.8, with the §15 measured-rect addendum).
 *
 * Reads the live gameplay DOM once per invalidation and hands the theme ONE reused layout
 * object in normalised screen fractions (y-down, (0, 0) top-left, divided by
 * innerWidth/innerHeight):
 *
 *   {
 *     card,          `.single-player-card` — the Vigil Stone / calm target (§15 item 1).
 *                    Absent → the primary board expanded by cardFromBoard() (cardDerived).
 *     board,         the primary board canvas (row mapping, spawn exclusion): player 0's board,
 *                    else the lowest-numbered local-MP board.
 *     queue / next,  `.single-player-card .player-next-pieces` (same object under both names).
 *     hud,           `.single-player-stats-bar`.
 *     boards,        fixed length PARHELION_PLAYER_SLOTS, indexed by the director's player slot
 *                    (0 = the solo board, 1..4 = `#p{n}` local-MP boards); null when absent.
 *                    Each present entry is a rect itself ({x0, y0, x1, y1}, which is what
 *                    ParhelionOpticsState.setLayout reads) and also carries
 *                    `{ rect, player, stoneBacked }`. `stoneBacked` is a hint only: true when
 *                    exactly one board is live; the runtime's stone solver has the final say.
 *     boardCount, mode ('' when no mode runs), aspect, width, height (CSS px),
 *     serenity,      Serenity mode: every rect null → calm count 0.
 *     fallback,      no card and no board outside Serenity: card and board = FALLBACK_RECT.
 *     cardDerived,   the card came from cardFromBoard().
 *     version,       increments on every DOM read (cheap change detection for consumers).
 *   }
 *
 * Sources, in priority order: `#p{n}-phaser-container canvas` (n = 1..4), then
 * `#phaser-game-container canvas`, `#main-game-canvas`, `#single-player-game-canvas` for the
 * solo slot. A rect under 32×64 CSS px, or entirely off screen, counts as absent.
 *
 * Caching: read() returns the cached layout until invalidate() is called, the window size
 * changes or the game mode changes. The theme invalidates on VIEWPORT_RESIZED and the mode
 * manager's modeStarted/modeActivated, and re-reads inside its frame loop — never from a bus
 * handler, since getBoundingClientRect forces layout.
 *
 * Allocation: every object the layout exposes is created in the constructor; reads only
 * write numbers into them and swap references between them and null.
 *
 * Import-safe in Node: nothing touches `window` or `document` until read() is called.
 */
import { FALLBACK_RECT, cardFromBoard } from '../../../playground/effects/parhelion-composition.js';
import { PARHELION_PLAYER_SLOTS } from '../sim/parhelion-reaction-director.js';

/** Rects smaller than this (CSS px) are hidden or collapsed boards, not layout. */
export const PARHELION_RECT_MIN_WIDTH_PX = 32;
export const PARHELION_RECT_MIN_HEIGHT_PX = 64;

/** GameModeManager id of the meditation mode (GAME_MODES.SERENITY). */
export const PARHELION_SERENITY_MODE_ID = 'serenity';

const DEFAULT_ASPECT = 16 / 9;

const PLAYER_BOARD_SELECTORS = Object.freeze(Array.from(
    { length: PARHELION_PLAYER_SLOTS },
    (_, player) => (player === 0 ? '' : `#p${player}-phaser-container canvas`),
));

export const PARHELION_RECT_SELECTORS = Object.freeze({
    card: '.single-player-card',
    queue: '.single-player-card .player-next-pieces',
    hud: '.single-player-stats-bar',
    /** Index = player slot; slot 0 uses `soloBoards` instead. */
    playerBoards: PLAYER_BOARD_SELECTORS,
    soloBoards: Object.freeze([
        '#phaser-game-container canvas',
        '#main-game-canvas',
        '#single-player-game-canvas',
    ]),
});

function clamp01(value) {
    if (value < 0) return 0;
    if (value > 1) return 1;
    return value;
}

function createRect() {
    return {
        x0: 0, y0: 0, x1: 0, y1: 0,
    };
}

function copyRect(src, dst) {
    dst.x0 = src.x0;
    dst.y0 = src.y0;
    dst.x1 = src.x1;
    dst.y1 = src.y1;
    return dst;
}

function createBoardEntry(player) {
    return {
        x0: 0,
        y0: 0,
        x1: 0,
        y1: 0,
        rect: createRect(),
        player,
        stoneBacked: false,
    };
}

function createLayout() {
    const boards = new Array(PARHELION_PLAYER_SLOTS);
    for (let index = 0; index < boards.length; index += 1) boards[index] = null;
    return {
        card: null,
        board: null,
        queue: null,
        next: null,
        hud: null,
        boards,
        boardCount: 0,
        mode: '',
        aspect: DEFAULT_ASPECT,
        width: 0,
        height: 0,
        serenity: false,
        fallback: false,
        cardDerived: false,
        version: 0,
    };
}

function defaultWindow() {
    return typeof window !== 'undefined' ? window : null;
}

function defaultDocument() {
    return typeof document !== 'undefined' ? document : null;
}

function defaultModeId() {
    const manager = typeof window !== 'undefined' ? window.serenityBlocks?.gameModeManager : null;
    const id = manager?.getCurrentModeId?.();
    return typeof id === 'string' ? id : '';
}

export class ParhelionBoardRects {
    /**
     * @param {{
     *   window?: object, document?: object, getModeId?: () => string,
     * }} [options] injection seams for tests; defaults read the globals lazily at read time.
     */
    constructor(options = {}) {
        const opts = options || {};
        this.windowRef = opts.window || null;
        this.documentRef = opts.document || null;
        this.getModeId = typeof opts.getModeId === 'function' ? opts.getModeId : defaultModeId;

        this.layout = createLayout();
        this.cardRect = createRect();
        this.boardRect = createRect();
        this.queueRect = createRect();
        this.hudRect = createRect();
        this.entries = new Array(PARHELION_PLAYER_SLOTS);
        for (let player = 0; player < PARHELION_PLAYER_SLOTS; player += 1) {
            this.entries[player] = createBoardEntry(player);
        }

        this.dirty = true;
        this.lastWidth = -1;
        this.lastHeight = -1;
        this.lastMode = null;
        /** Diagnostics: completed DOM read passes. */
        this.domReads = 0;
    }

    /** The next read() queries the DOM again. */
    invalidate() {
        this.dirty = true;
    }

    /** @returns {object} the reused layout object (see the module header). */
    read() {
        const win = this.windowRef || defaultWindow();
        const width = Number(win?.innerWidth) || 0;
        const height = Number(win?.innerHeight) || 0;
        let mode = '';
        try {
            mode = this.getModeId() || '';
        } catch (error) {
            mode = '';
        }
        if (!this.dirty && width === this.lastWidth && height === this.lastHeight && mode === this.lastMode) {
            return this.layout;
        }
        this.dirty = false;
        this.lastWidth = width;
        this.lastHeight = height;
        this.lastMode = mode;
        this.readDom(this.documentRef || defaultDocument(), width, height, mode);
        return this.layout;
    }

    /** @private */
    readDom(doc, width, height, mode) {
        const l = this.layout;
        l.version += 1;
        l.width = width;
        l.height = height;
        l.aspect = width > 0 && height > 0 ? width / height : DEFAULT_ASPECT;
        l.mode = mode;
        l.serenity = mode === PARHELION_SERENITY_MODE_ID;
        l.card = null;
        l.board = null;
        l.queue = null;
        l.next = null;
        l.hud = null;
        l.boardCount = 0;
        l.fallback = false;
        l.cardDerived = false;
        for (let player = 0; player < l.boards.length; player += 1) l.boards[player] = null;

        // Serenity: the meditation field keeps no calm rects at all (§7.8).
        if (l.serenity) return;

        const canQuery = !!doc && typeof doc.querySelector === 'function' && width > 0 && height > 0;
        if (canQuery) {
            this.domReads += 1;
            this.readBoards(doc, width, height);
            if (this.measure(doc, PARHELION_RECT_SELECTORS.card, width, height, this.cardRect)) {
                l.card = this.cardRect;
            } else if (l.board) {
                l.card = cardFromBoard(l.board, this.cardRect);
                l.cardDerived = true;
            }
            if (this.measure(doc, PARHELION_RECT_SELECTORS.queue, width, height, this.queueRect)) {
                l.queue = this.queueRect;
                l.next = this.queueRect;
            }
            if (this.measure(doc, PARHELION_RECT_SELECTORS.hud, width, height, this.hudRect)) {
                l.hud = this.hudRect;
            }
        }

        // No card and no canvas outside Serenity: the §6 fallback rect.
        if (!l.card && !l.board) {
            l.card = copyRect(FALLBACK_RECT, this.cardRect);
            l.board = copyRect(FALLBACK_RECT, this.boardRect);
            l.fallback = true;
        }
    }

    /** @private Local-MP boards first; the solo chain fills slot 0 only when none is live. */
    readBoards(doc, width, height) {
        const l = this.layout;
        const { playerBoards, soloBoards } = PARHELION_RECT_SELECTORS;
        let count = 0;
        for (let player = 1; player < l.boards.length; player += 1) {
            const entry = this.entries[player];
            if (this.measure(doc, playerBoards[player], width, height, entry)) {
                l.boards[player] = entry;
                count += 1;
            }
        }
        if (count === 0) {
            const entry = this.entries[0];
            for (let index = 0; index < soloBoards.length; index += 1) {
                if (this.measure(doc, soloBoards[index], width, height, entry)) {
                    l.boards[0] = entry;
                    count = 1;
                    break;
                }
            }
        }
        l.boardCount = count;
        for (let player = 0; player < l.boards.length; player += 1) {
            const entry = l.boards[player];
            if (entry) {
                copyRect(entry, entry.rect);
                entry.stoneBacked = count === 1;
                if (!l.board) l.board = copyRect(entry, this.boardRect);
            }
        }
    }

    /** @private Writes the normalised rect into `out`; false when absent/tiny/off screen. */
    measure(doc, selector, width, height, out) {
        if (!selector) return false;
        let element = null;
        try {
            element = doc.querySelector(selector);
        } catch (error) {
            return false;
        }
        if (!element || typeof element.getBoundingClientRect !== 'function') return false;
        const r = element.getBoundingClientRect();
        const w = Number(r?.width) || 0;
        const h = Number(r?.height) || 0;
        if (w < PARHELION_RECT_MIN_WIDTH_PX || h < PARHELION_RECT_MIN_HEIGHT_PX) return false;
        const left = Number(r.left) || 0;
        const top = Number(r.top) || 0;
        const x0 = clamp01(left / width);
        const y0 = clamp01(top / height);
        const x1 = clamp01((left + w) / width);
        const y1 = clamp01((top + h) / height);
        if (!(x1 > x0) || !(y1 > y0)) return false;
        out.x0 = x0;
        out.y0 = y0;
        out.x1 = x1;
        out.y1 = y1;
        return true;
    }
}

export default ParhelionBoardRects;
