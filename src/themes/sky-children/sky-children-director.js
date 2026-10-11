/**
 * Sky Children — gameplay reaction director.
 *
 * Renderer-free, DOM-free, bus-free. The canonical gameplay events are delivered synchronously
 * inside the simulation tick, several per lock (HARD_DROP, PIECE_LOCK, then LINE_CLEAR / COMBO /
 * TSPIN / PERFECT_CLEAR once per cascade wave), so every on*() handler only STAGES numbers into
 * one of five preallocated player slots. flush() — called first in the theme's frame, after the
 * camera — resolves each pending slot into at most one `lock` and one `clear` for the sink:
 *
 *   sink.lock({ player, rows, u, hardDrop, dropRows, color, shape, cells, silent, screen })
 *   sink.clear({ player, rows, lines, combo, cascade, tspin, perfect, b2b, screen })
 *   sink.combo(n, player)      the true combo, whenever it changes (0 = the chain broke)
 *   sink.levelUp(level)
 *
 * `rows` are VISIBLE board rows (0 = the top row, 19 = the floor); `u` is the lock's column as a
 * fraction of the board width; `color` is the piece's colour (a CSS hex string) or null; `shape`
 * is its key (I, O, T, S, Z, J, L) or null and `cells` its occupied cells in the orientation it
 * locked in (eight numbers: x, y offsets from their own centre, y up; see cellsFromMatrix) or
 * null, so the light-copy that leaves the card has the piece's shape. `dropRows` is how far a
 * hard drop fell (the HARD_DROP payload's `distance`, rows, 0 for anything else). `screen`
 * ({ x, y } in window fractions, y down) is set instead for the meditation mode's clicks, which
 * carry a pixel position and no board.
 *
 * Silent locks: with the lock ripple switched off (the pieceLockRipple setting) a lock is still
 * delivered, with `silent: true`, `hardDrop: false` and `dropRows: 0`. The world then skips the
 * copy, the thread, the splash and the camera dip, but the pool still takes the colour, so a clear
 * always has colour to release, and the chain is counted as it always is. The setting is read
 * when the lock lands: a lock staged before it was switched off lands silent, never cancelled.
 *
 * Order inside one flush: a slot's lock, then its clear, then its combo. A clear therefore
 * reaches the sink BEFORE the combo it raised: read the chain a clear belongs to from the clear's
 * own `combo`, never from the last sink.combo() call.
 *
 * Combo: the bus's COMBO event carries the CASCADE DEPTH of one lock, never a combo (ADR-0011).
 * The true consecutive-clear combo is derived here with one ComboTracker per player; an explicit
 * LINE_CLEAR.comboCount (meditation clicks, Odyssey's victory lap) can raise it for the frame
 * that clear resolves in. The game says nothing when a piece clears no line, so a chain is known
 * to have broken only when the NEXT piece locks: sink.combo(0) arrives one lock late. If that
 * piece starts a new chain in the same tick (1 -> 0 -> 1), the sink is still told of the break:
 * combo(0), then combo(1).
 *
 * Staged events are delivered once: a sink that throws on one does not see it again next frame.
 *
 * Allocation: handlers write numbers into preallocated slots; flush() reuses one lock and one
 * clear object. The sink must copy what it keeps.
 */
import { ComboTracker } from '../../core/combo-tracker.js';
import { readLockViewportOrigin } from '../../events/lock-origin.js';
import { BOARD_GRID, PLAYER_SLOTS } from './sky-children-composition.js';
import { SKY_CHILDREN_TETROMINOS } from './sky-children-tetrominos.js';
import { cellsFromMatrix } from './sky-children-core.js';

const MAX_ROWS = 4;
const MAX_SHAPE_SIZE = 8;
const EMPTY = Object.freeze({});
const HEX = /^#[0-9a-f]{6}$/i;

/** Canonical EVENTS key → director handler name, for the theme's bus wiring. */
export const SKY_CHILDREN_EVENT_HANDLERS = Object.freeze({
    PIECE_LOCK: 'onPieceLock',
    HARD_DROP: 'onHardDrop',
    LINE_CLEAR: 'onLineClear',
    COMBO: 'onCombo',
    TSPIN: 'onTSpin',
    B2B: 'onB2B',
    PERFECT_CLEAR: 'onPerfectClear',
    LEVEL_UP: 'onLevelUp',
});

const finite = (value, fallback) => (Number.isFinite(value) ? Number(value) : fallback);
const clampRow = (row) => Math.max(0, Math.min(BOARD_GRID.rows - 1, Math.round(row)));

/**
 * This theme's colour for a shape key, or null. The table is read in either of the two shapes a
 * theme's tetromino config comes in: `{ colors: { T: '#…' } }` or `{ T: { color: '#…' } }`. Only
 * a hex counts (a table's `ghost` is an rgba() and is no piece).
 * @param {string} key
 * @param {object} [table]
 * @returns {string|null}
 */
export function themePieceColor(key, table = SKY_CHILDREN_TETROMINOS) {
    if (typeof key !== 'string' || !table) return null;
    const fromMap = table.colors && Object.prototype.hasOwnProperty.call(table.colors, key) ? table.colors[key] : null;
    const own = Object.prototype.hasOwnProperty.call(table, key) ? table[key] : null;
    const color = fromMap ?? own?.color ?? null;
    return typeof color === 'string' && HEX.test(color) ? color : null;
}

/**
 * The piece's own colour if it carries a hex, else this theme's colour for its shape.
 * @param {object|null|undefined} piece
 * @returns {string|null}
 */
export function resolvePieceColor(piece) {
    if (!piece) return null;
    if (typeof piece.color === 'string' && HEX.test(piece.color)) return piece.color;
    return themePieceColor(piece.type || piece.shapeKey || piece.color);
}

function createSlot() {
    return {
        assigned: false,
        player: 0,
        pending: false,
        // lock intake
        lock: false,
        hardDrop: false,
        dropRows: 0,
        lockRows: new Int16Array(MAX_ROWS),
        lockRowCount: 0,
        lockU: 0.5,
        lockColor: null,
        lockShape: null,
        lockCells: new Float32Array(8),
        hasCells: false,
        // clear intake
        lines: 0,
        cascade: 1,
        clearRows: new Int16Array(MAX_ROWS),
        clearRowCount: 0,
        explicitCombo: -1,
        tspin: false,
        perfect: false,
        b2b: false,
        hasPosition: false,
        posX: 0,
        posY: 0,
        // persistent per-player state
        tracker: new ComboTracker(),
        reported: 0,
        /** The chain the sink was last told of broke since: say so before anything newer. */
        broke: false,
    };
}

function clearPending(slot) {
    slot.pending = false;
    slot.lock = false;
    slot.hardDrop = false;
    slot.dropRows = 0;
    slot.lockRowCount = 0;
    slot.lockColor = null;
    slot.lockShape = null;
    slot.hasCells = false;
    slot.lines = 0;
    slot.cascade = 1;
    slot.clearRowCount = 0;
    slot.explicitCombo = -1;
    slot.tspin = false;
    slot.perfect = false;
    slot.b2b = false;
    slot.hasPosition = false;
}

/**
 * Lock rows and column: Infinity's on-playfield viewportOrigin wins; otherwise the rows and the
 * centroid of the OCCUPIED shape cells (the matrix is padded — never its bounding box).
 */
function captureLock(slot, payload) {
    const piece = payload.piece || EMPTY;
    const color = resolvePieceColor(piece);
    if (color) slot.lockColor = color;
    const key = typeof piece.type === 'string' ? piece.type : piece.shapeKey;
    if (typeof key === 'string' && key.length <= 8) slot.lockShape = key;
    const own = cellsFromMatrix(piece.shape);
    if (own) {
        for (let i = 0; i < 8; i += 1) slot.lockCells[i] = own[i];
        slot.hasCells = true;
    }
    if (payload.viewportOrigin) {
        const viewport = readLockViewportOrigin(payload);
        if (viewport) {
            slot.lockRows[0] = clampRow(Math.floor(viewport.y * BOARD_GRID.rows));
            slot.lockRowCount = 1;
            slot.lockU = viewport.x;
            return;
        }
    }
    const { shape } = piece;
    if (!Array.isArray(shape)) return;
    const pieceX = finite(piece.x, BOARD_GRID.columns * 0.5 - 1);
    const pieceY = finite(piece.y, BOARD_GRID.hiddenRows);
    let totalX = 0;
    let occupied = 0;
    let rowCount = 0;
    const rowLimit = Math.min(shape.length, MAX_SHAPE_SIZE);
    for (let r = 0; r < rowLimit; r += 1) {
        const row = shape[r];
        if (!Array.isArray(row)) continue;
        let cells = 0;
        const columnLimit = Math.min(row.length, MAX_SHAPE_SIZE);
        for (let c = 0; c < columnLimit; c += 1) {
            if (Number(row[c]) > 0) {
                totalX += pieceX + c + 0.5;
                cells += 1;
            }
        }
        if (cells > 0) {
            occupied += cells;
            if (rowCount < MAX_ROWS) {
                slot.lockRows[rowCount] = clampRow(pieceY + r - BOARD_GRID.hiddenRows);
                rowCount += 1;
            }
        }
    }
    if (occupied === 0) return;
    slot.lockRowCount = rowCount;
    slot.lockU = Math.max(0, Math.min(1, totalX / occupied / BOARD_GRID.columns));
}

/** Cleared rows: LINE_CLEAR viewportOrigin.y (Infinity) > the payload's cleared rows. */
function captureClearRows(slot, payload, lines) {
    if (payload.viewportOrigin) {
        const viewport = readLockViewportOrigin(payload);
        if (viewport) {
            const first = clampRow(Math.floor(viewport.y * BOARD_GRID.rows) - (lines - 1) * 0.5);
            slot.clearRowCount = Math.min(MAX_ROWS, lines);
            for (let i = 0; i < slot.clearRowCount; i += 1) slot.clearRows[i] = clampRow(first + i);
            return;
        }
    }
    const rows = payload.clearedRows;
    slot.clearRowCount = 0;
    if (!Array.isArray(rows)) return;
    for (let i = 0; i < rows.length && slot.clearRowCount < MAX_ROWS; i += 1) {
        if (Number.isFinite(rows[i])) {
            slot.clearRows[slot.clearRowCount] = clampRow(Number(rows[i]) - BOARD_GRID.hiddenRows);
            slot.clearRowCount += 1;
        }
    }
}

function capturePosition(slot, payload) {
    const { position } = payload;
    if (position && Number.isFinite(position.x) && Number.isFinite(position.y)) {
        slot.hasPosition = true;
        slot.posX = Number(position.x);
        slot.posY = Number(position.y);
    }
}

export class SkyChildrenDirector {
    /**
     * @param {{
     *   sink?: { lock?: Function, clear?: Function, combo?: Function, levelUp?: Function },
     *   enabled?: boolean, lockRipple?: boolean,
     * }} [options]
     */
    constructor(options = EMPTY) {
        this.sink = options.sink || null;
        this.enabled = options.enabled !== false;
        this.lockRipple = options.lockRipple !== false;
        this.viewportWidth = 0;
        this.viewportHeight = 0;
        this.droppedEvents = 0;
        this.level = 0;
        this.levelPending = false;
        this.slots = Array.from({ length: PLAYER_SLOTS }, createSlot);
        this._lock = {
            player: 0,
            rows: [],
            u: 0.5,
            hardDrop: false,
            dropRows: 0,
            color: null,
            shape: null,
            cells: null,
            silent: false,
            screen: null,
        };
        this._cells = [0, 0, 0, 0, 0, 0, 0, 0];
        this._clear = {
            player: 0, rows: [], lines: 1, combo: 1, cascade: 1, tspin: false, perfect: false, b2b: false, screen: null,
        };
        this._screen = { x: 0.5, y: 0.5 };
    }

    /**
     * Settings may change at any time. Disabling reactions drops everything staged and every
     * combo, so re-enabling can never replay stale gameplay. The lock ripple only decides how a
     * lock lands (silent or not, read when it lands): nothing staged is cancelled.
     * @param {{ enabled?: boolean, lockRipple?: boolean }} [options]
     */
    configure(options = EMPTY) {
        if (options.lockRipple !== undefined) this.lockRipple = options.lockRipple !== false;
        if (options.enabled !== undefined) {
            const enabled = options.enabled !== false;
            if (this.enabled && !enabled) this.reset();
            this.enabled = enabled;
        }
    }

    /**
     * Window size (CSS px) for normalising the meditation mode's click positions.
     * @param {number} width
     * @param {number} height
     */
    setViewport(width, height) {
        this.viewportWidth = Number.isFinite(width) && width > 0 ? Number(width) : 0;
        this.viewportHeight = Number.isFinite(height) && height > 0 ? Number(height) : 0;
    }

    /** The slot for this payload's player (0 = the default board), or null when every slot is taken. */
    slotFor(payload) {
        const player = Number.isFinite(payload.player) ? Math.trunc(Number(payload.player)) : 0;
        let free = null;
        for (let i = 0; i < this.slots.length; i += 1) {
            const slot = this.slots[i];
            if (slot.assigned && slot.player === player) return slot;
            if (!slot.assigned && free === null) free = slot;
        }
        if (free === null) {
            this.droppedEvents += 1;
            return null;
        }
        free.assigned = true;
        free.player = player;
        return free;
    }

    // ── intake: synchronous bus handlers → stage numbers only ───────────────────

    onPieceLock(event) {
        if (!this.enabled) return false;
        const payload = event || EMPTY;
        const slot = this.slotFor(payload);
        if (!slot) return false;
        slot.pending = true;
        slot.lock = true; // silent or not is decided when it lands
        // The piece before this one cleared nothing: the chain the sink knows of is over.
        if (slot.tracker.notePieceLocked() === 0 && slot.reported > 0) slot.broke = true;
        captureLock(slot, payload);
        return true;
    }

    /** Same tick as, and just BEFORE, the PIECE_LOCK of the same piece. */
    onHardDrop(event) {
        if (!this.enabled) return false;
        const payload = event || EMPTY;
        const slot = this.slotFor(payload);
        if (!slot) return false;
        slot.pending = true;
        slot.hardDrop = true;
        slot.dropRows = Math.max(0, finite(payload.distance, 0));
        captureLock(slot, payload);
        return true;
    }

    onLineClear(event) {
        if (!this.enabled) return false;
        const payload = event || EMPTY;
        const slot = this.slotFor(payload);
        if (!slot) return false;
        slot.pending = true;
        const cascade = Math.max(1, Math.min(255, Math.trunc(finite(payload.cascadeCount, 1))));
        const rows = payload.clearedRows;
        const fallbackLines = Array.isArray(rows) && rows.length > 0 ? rows.length : 1;
        const lines = Math.max(1, Math.min(MAX_ROWS, Math.trunc(finite(payload.lineCount, fallbackLines))));
        if (slot.lines === 0 || lines > slot.lines) {
            // Several waves in one frame: the widest one names the rows.
            slot.lines = lines;
            captureClearRows(slot, payload, lines);
        }
        slot.cascade = Math.max(slot.cascade, cascade);
        slot.tracker.noteLineClear();
        if (Number.isFinite(payload.comboCount)) {
            slot.explicitCombo = Math.max(slot.explicitCombo, Math.trunc(Number(payload.comboCount)));
        }
        capturePosition(slot, payload);
        return true;
    }

    /**
     * COMBO carries cascade DEPTH (fires once per wave >= 2), never a combo. The exception is a
     * meditation click (it carries `position`), where comboCount is the click combo.
     */
    onCombo(event) {
        if (!this.enabled) return false;
        const payload = event || EMPTY;
        const slot = this.slotFor(payload);
        if (!slot) return false;
        const count = Math.max(0, Math.trunc(finite(payload.comboCount, 0)));
        const { position } = payload;
        if (position && Number.isFinite(position.x) && Number.isFinite(position.y)) {
            slot.pending = true;
            slot.explicitCombo = Math.max(slot.explicitCombo, count);
            capturePosition(slot, payload);
            if (slot.lines === 0) slot.lines = 1;
        } else if (slot.lines > 0) {
            slot.cascade = Math.max(slot.cascade, count);
        }
        return true;
    }

    onTSpin(event) {
        if (!this.enabled) return false;
        const payload = event || EMPTY;
        const slot = this.slotFor(payload);
        if (!slot) return false;
        slot.pending = true;
        slot.tspin = true;
        const lines = Math.max(0, Math.min(MAX_ROWS, Math.trunc(finite(payload.lineCount, 0))));
        if (lines > slot.lines) slot.lines = lines;
        return true;
    }

    onB2B(event) {
        if (!this.enabled) return false;
        const payload = event || EMPTY;
        if (payload.active === false) return false;
        const slot = this.slotFor(payload);
        if (!slot) return false;
        slot.b2b = true;
        return true;
    }

    onPerfectClear(event) {
        if (!this.enabled) return false;
        const slot = this.slotFor(event || EMPTY);
        if (!slot) return false;
        slot.pending = true;
        slot.perfect = true;
        if (slot.lines === 0) slot.lines = 1;
        return true;
    }

    onLevelUp(event) {
        const level = finite((event || EMPTY).level, this.level + 1);
        this.level = Math.max(1, Math.round(level));
        this.levelPending = true;
        return true;
    }

    // ── resolve ─────────────────────────────────────────────────────────────────

    /** Resolve everything staged since the last frame into sink calls. */
    flush() {
        const { sink } = this;
        if (this.levelPending) {
            this.levelPending = false;
            sink?.levelUp?.(this.level);
        }
        for (let i = 0; i < this.slots.length; i += 1) {
            const slot = this.slots[i];
            if (slot.assigned) this.resolve(slot, sink);
        }
    }

    resolve(slot, sink) {
        if (slot.broke) {
            slot.broke = false;
            if (slot.reported !== 0) {
                slot.reported = 0;
                sink?.combo?.(0, slot.player);
            }
        }
        const combo = Math.max(slot.tracker.combo, slot.lines > 0 ? Math.max(1, slot.explicitCombo) : 0);
        if (slot.pending) {
            // Whatever the sink does with them, staged events are delivered once: one that makes
            // the sink throw must not come back on every later frame.
            try {
                this.deliver(slot, sink, combo);
            } finally {
                clearPending(slot);
            }
        }
        if (combo !== slot.reported) {
            slot.reported = combo;
            sink?.combo?.(combo, slot.player);
        }
    }

    deliver(slot, sink, combo) {
        let screen = null;
        if (slot.hasPosition) {
            const w = this.viewportWidth || globalThis.window?.innerWidth || 0;
            const h = this.viewportHeight || globalThis.window?.innerHeight || 0;
            if (w > 0 && h > 0) {
                screen = this._screen;
                screen.x = Math.max(0, Math.min(1, slot.posX / w));
                screen.y = Math.max(0, Math.min(1, slot.posY / h));
            }
        }
        if ((slot.lock || slot.hardDrop) && slot.lockRowCount > 0 && sink?.lock) {
            const c = this._lock;
            const silent = !this.lockRipple;
            c.player = slot.player;
            c.rows.length = 0;
            for (let r = 0; r < slot.lockRowCount; r += 1) c.rows.push(slot.lockRows[r]);
            c.u = slot.lockU;
            // A silent lock is a lock without its drop: no jet, no dip, no spray off a lip.
            c.hardDrop = slot.hardDrop && !silent;
            c.dropRows = c.hardDrop ? slot.dropRows : 0;
            c.color = slot.lockColor;
            c.shape = slot.lockShape;
            if (slot.hasCells) {
                for (let k = 0; k < 8; k += 1) this._cells[k] = slot.lockCells[k];
                c.cells = this._cells;
            } else c.cells = null;
            c.silent = silent;
            c.screen = null;
            sink.lock(c);
        }
        if (slot.lines > 0 && sink?.clear) {
            const c = this._clear;
            c.player = slot.player;
            c.rows.length = 0;
            for (let r = 0; r < slot.clearRowCount; r += 1) c.rows.push(slot.clearRows[r]);
            c.lines = slot.lines;
            c.combo = Math.max(1, combo);
            c.cascade = slot.cascade;
            c.tspin = slot.tspin;
            c.perfect = slot.perfect;
            c.b2b = slot.b2b;
            c.screen = screen;
            sink.clear(c);
        }
    }

    /** A new run, or reactions switched off: drop everything staged and every combo. */
    reset() {
        for (let i = 0; i < this.slots.length; i += 1) {
            const slot = this.slots[i];
            clearPending(slot);
            slot.tracker.reset();
            slot.broke = false;
            if (slot.reported !== 0) {
                slot.reported = 0;
                this.sink?.combo?.(0, slot.player);
            }
            slot.assigned = false;
            slot.player = 0;
        }
        this.levelPending = false;
    }
}
