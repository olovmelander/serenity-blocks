/**
 * Rainbark — gameplay reaction director.
 *
 * Renderer-free, DOM-free, bus-free. The canonical gameplay events are delivered synchronously
 * inside the simulation tick, several per lock (HARD_DROP, PIECE_LOCK, then LINE_CLEAR / COMBO /
 * TSPIN / B2B once per cascade wave, PERFECT_CLEAR on a later frame), so every on*() handler only
 * STAGES numbers into one of five preallocated player slots. flush() — called first in the
 * theme's frame — resolves each slot into at most one `lock` and one `clear` for the sink:
 *
 *   sink.lock({ player, rows, u, hardDrop, distance, color, shape, cells, screen })
 *   sink.clear({ player, rows, lines, combo, cascade, tspin, perfect, b2b, crown, rowCodes, screen })
 *   sink.spin({ player, rows, u })  a T-spin that cleared nothing (the T's rows and column)
 *   sink.combo(n, player)      the true combo, whenever it changes (0 = the chain broke)
 *   sink.b2b(level, player)    the live back-to-back level (0..3), whenever it changes
 *   sink.levelUp(level)
 *
 * `rows` are VISIBLE board rows (0 = the top row, 19 = the floor), a clear's lowest row first;
 * `u` is the lock's column as a fraction of the board width; `distance` is how many rows a hard
 * drop fell (0 for any other lock); `color` is the piece's colour (a CSS hex string) or null;
 * `shape` is its key (I, O, T, S, Z, J, L) or null and `cells` its occupied cells in the
 * orientation it locked in (eight numbers: x, y offsets from their own centre, y up; see
 * cellsFromMatrix) or null. `rowCodes` holds each cleared row's ten cells as bark codes
 * (PIECE_CODE: I 0, T 1, Z 2, L 3, S 4, J 5, O 6, 7 = garbage or unknown), flat and in step with
 * `rows`: row k's column c is rowCodes[k * 10 + c], left to right. `screen` ({ x, y } in window
 * fractions, y down) is set instead for the meditation mode's clicks, which carry a pixel
 * position and no board.
 *
 * A perfect clear is settled by physics AFTER its clear's last wave (~360 ms later, in a frame of
 * its own): it then resolves as a clear with `crown: true`, `perfect: true` and no rows of its own:
 * the crown on the clear still playing, never a new one-line clear. A perfect clear that lands in
 * its clear's own frame rides on that clear (`crown` false).
 *
 * Order inside one flush: a slot's lock, then its clear, then its combo, then its back-to-back
 * level. A clear therefore reaches the sink BEFORE the combo it raised: read the chain a clear
 * belongs to from the clear's own `combo`, never from the last sink.combo() call.
 *
 * The shadow well: each slot remembers which piece filled which cell, from the PIECE_LOCK
 * snapshots (the locked matrix at piece.x / piece.y, absolute board rows with the four hidden
 * ones), so a clear can say what its rows were made of. Cleared rows leave the well and the rows
 * above them drop. Infinity's tall grid is keyed by the same absolute rows, so one sparse table
 * of the latest 64 rows serves both (a 24-row board never fills it). Cells the well never saw
 * are 7; a row it knows nothing of at all (Odyssey's synthetic clears, a row from before the
 * theme was listening) is dealt from the last eight lock codes instead. Garbage that local or
 * online play pushes in from below is not on the bus, so after it the well is a few rows out.
 *
 * Combo: the bus's COMBO event carries the CASCADE DEPTH of one lock, never a combo (ADR-0011).
 * The true consecutive-clear combo is derived here with one ComboTracker per player; an explicit
 * LINE_CLEAR.comboCount (meditation clicks, Odyssey's victory lap) can raise it for the frame
 * that clear resolves in. The game says nothing when a piece clears no line, but a lock's first
 * clear always lands in the tick it locks in, so a lock that reaches flush() without a clear has
 * broken the chain: combo(0) goes out on that lock, and the tracker's own 0 when the next piece
 * locks is not reported twice. A clear that still turns up for that lock before the next one
 * (online play delivers clears late) picks the chain back up. If two locks share a frame and the
 * second starts a new chain (1 -> 0 -> 1), the sink is still told of the break: combo(0), then
 * combo(1).
 *
 * Back-to-back: the game sends B2B on each difficult clear (four lines or a T-spin) after the
 * first, and never says when the run ends. Each B2B steps the level (at most 3); a wave-1 clear
 * of fewer than four lines with no T-spin after it ends the run (level 0).
 *
 * Cascade depth: local multiplayer's LINE_CLEAR has no cascadeCount; the depth arrives only as
 * the COMBO that precedes the wave's LINE_CLEAR in the same tick, so a COMBO with no clear yet
 * staged is held for the next LINE_CLEAR of that slot and dropped at the end of the frame.
 *
 * Allocation: handlers write numbers into preallocated slots; flush() reuses one lock and one
 * clear object. The sink must copy what it keeps.
 */
import { ComboTracker } from '../../core/combo-tracker.js';
import { readLockViewportOrigin } from '../../events/lock-origin.js';
import { BOARD_GRID, PLAYER_SLOTS } from './rainbark-composition.js';
import { RAINBARK_TETROMINOS } from './rainbark-tetrominos.js';
import { PIECE_CODE, cellsFromMatrix, pieceCode } from './rainbark-core.js';

const MAX_ROWS = 4;
const MAX_SHAPE_SIZE = 8;
const COLUMNS = BOARD_GRID.columns;
/** Absolute rows the shadow well remembers per slot. */
const WELL_ROWS = 64;
/** Lock codes kept for the rows the well cannot name. */
const RING_SIZE = 8;
/** Most cleared rows read from one LINE_CLEAR payload. */
const MAX_CLEARED = 32;
const MAX_B2B = 3;
const MAX_DISTANCE = 255;
/** A well cell no lock has filled. */
const UNKNOWN = 255;
const EMPTY = Object.freeze({});
const HEX = /^#[0-9a-f]{6}$/i;

/** Canonical EVENTS key → director handler name, for the theme's bus wiring. */
export const RAINBARK_EVENT_HANDLERS = Object.freeze({
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
const hasPosition = (position) => !!position && Number.isFinite(position.x) && Number.isFinite(position.y);

/**
 * This theme's colour for a shape key, or null. The table is read in either of the two shapes a
 * theme's tetromino config comes in: `{ colors: { T: '#…' } }` or `{ T: { color: '#…' } }`. Only
 * a hex counts.
 */
export function themePieceColor(key, table = RAINBARK_TETROMINOS) {
    if (typeof key !== 'string' || !table) return null;
    const fromMap = table.colors && Object.prototype.hasOwnProperty.call(table.colors, key) ? table.colors[key] : null;
    const own = Object.prototype.hasOwnProperty.call(table, key) ? table[key] : null;
    const color = fromMap ?? own?.color ?? null;
    return typeof color === 'string' && HEX.test(color) ? color : null;
}

/** The piece's own colour if it carries a hex, else this theme's colour for its shape. */
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
        /** A PIECE_LOCK landed this frame, whatever the lock ripple setting says. */
        locked: false,
        lock: false,
        hardDrop: false,
        distance: 0,
        lockRows: new Int16Array(MAX_ROWS),
        lockRowCount: 0,
        lockU: 0.5,
        lockColor: null,
        lockShape: null,
        lockCells: new Float32Array(8),
        hasCells: false,
        // clear intake
        lines: 0,
        /** LINE_CLEAR waves staged this frame. */
        waves: 0,
        cascade: 1,
        clearRows: new Int16Array(MAX_ROWS),
        clearRowCount: 0,
        clearCodes: new Uint8Array(MAX_ROWS * COLUMNS),
        explicitCombo: -1,
        tspin: false,
        perfect: false,
        b2b: false,
        /** A perfect clear on a frame of its own: the crown on the clear before it. */
        crown: false,
        hasPosition: false,
        posX: 0,
        posY: 0,
        /** Cascade depth a COMBO named before its LINE_CLEAR; lives until the end of the frame. */
        stash: 0,
        // persistent per-player state
        tracker: new ComboTracker(),
        reported: 0,
        /** The chain the sink was last told of broke since: say so before anything newer. */
        broke: false,
        /** combo(0) went out on the breaking lock; the tracker holds the old chain until the next one. */
        breakSent: false,
        b2bLevel: 0,
        b2bReported: 0,
        /** The back-to-back run the sink was last told of ended since. */
        b2bBroke: false,
        /** A wave-1 clear of fewer than four lines, waiting on the T-spin that may follow it. */
        b2bCandidate: false,
        // shadow well
        wellKey: new Int32Array(WELL_ROWS),
        /** When each entry was last written (0 = free), for dropping the stalest row. */
        wellStamp: new Float64Array(WELL_ROWS),
        wellCodes: new Uint8Array(WELL_ROWS * COLUMNS),
        wellClock: 0,
        ring: new Uint8Array(RING_SIZE),
        ringHead: 0,
        ringCount: 0,
        /** One clear's absolute rows, lowest on the board first. */
        sortRows: new Int32Array(MAX_ROWS),
    };
}

function clearPending(slot) {
    slot.pending = false;
    slot.locked = false;
    slot.lock = false;
    slot.hardDrop = false;
    slot.distance = 0;
    slot.lockRowCount = 0;
    slot.lockColor = null;
    slot.lockShape = null;
    slot.hasCells = false;
    slot.lines = 0;
    slot.waves = 0;
    slot.cascade = 1;
    slot.clearRowCount = 0;
    slot.explicitCombo = -1;
    slot.tspin = false;
    slot.perfect = false;
    slot.b2b = false;
    slot.crown = false;
    slot.hasPosition = false;
    slot.stash = 0;
}

function clearWell(slot) {
    slot.wellStamp.fill(0);
    slot.wellClock = 0;
    slot.ringHead = 0;
    slot.ringCount = 0;
}

/** A wave-1 clear that no T-spin followed in its own tick: the back-to-back run is over. */
function settleB2B(slot) {
    if (!slot.b2bCandidate) return;
    slot.b2bCandidate = false;
    if (slot.b2bLevel > 0) {
        slot.b2bLevel = 0;
        slot.b2bBroke = true;
    }
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

/** Rows a hard drop fell: the payload's distance, else end minus start. */
function dropDistance(payload) {
    let rows = finite(payload.distance, NaN);
    if (!Number.isFinite(rows) && Number.isFinite(payload.endY) && Number.isFinite(payload.startY)) {
        rows = Number(payload.endY) - Number(payload.startY);
    }
    return Number.isFinite(rows) ? Math.max(0, Math.min(MAX_DISTANCE, Math.round(rows))) : 0;
}

// ── the shadow well ─────────────────────────────────────────────────────────────

/** The well entry holding absolute board row `key`, or -1. */
function wellFind(slot, key) {
    for (let e = 0; e < WELL_ROWS; e += 1) {
        if (slot.wellStamp[e] > 0 && slot.wellKey[e] === key) return e;
    }
    return -1;
}

/** The entry for `key`, taking a free one (else the row written longest ago) for a new row. */
function wellClaim(slot, key) {
    let e = wellFind(slot, key);
    if (e < 0) {
        e = 0;
        for (let i = 0; i < WELL_ROWS; i += 1) {
            if (slot.wellStamp[i] === 0) {
                e = i;
                break;
            }
            if (slot.wellStamp[i] < slot.wellStamp[e]) e = i;
        }
        slot.wellKey[e] = key;
        slot.wellCodes.fill(UNKNOWN, e * COLUMNS, (e + 1) * COLUMNS);
    }
    slot.wellClock += 1;
    slot.wellStamp[e] = slot.wellClock;
    return e;
}

/** A locked piece fills its cells with its code, and joins the ring of recent lock codes. */
function wellLock(slot, piece) {
    const key = typeof piece.type === 'string' ? piece.type : piece.shapeKey;
    const code = pieceCode(key);
    if (typeof key === 'string') {
        slot.ring[slot.ringHead] = code;
        slot.ringHead = (slot.ringHead + 1) % RING_SIZE;
        slot.ringCount = Math.min(RING_SIZE, slot.ringCount + 1);
    }
    const { shape } = piece;
    if (!Array.isArray(shape) || !Number.isFinite(piece.x) || !Number.isFinite(piece.y)) return;
    const x0 = Math.round(Number(piece.x));
    const y0 = Math.round(Number(piece.y));
    const rowLimit = Math.min(shape.length, MAX_SHAPE_SIZE);
    for (let r = 0; r < rowLimit; r += 1) {
        const row = shape[r];
        if (!Array.isArray(row) || y0 + r < 0) continue;
        let e = -1;
        const columnLimit = Math.min(row.length, MAX_SHAPE_SIZE);
        for (let c = 0; c < columnLimit; c += 1) {
            const x = x0 + c;
            if (Number(row[c]) > 0 && x >= 0 && x < COLUMNS) {
                if (e < 0) e = wellClaim(slot, y0 + r);
                slot.wellCodes[e * COLUMNS + x] = code;
            }
        }
    }
}

/** The n-th latest lock code (0 = the latest), wrapping round the ring. */
function ringAt(slot, n) {
    return slot.ring[(slot.ringHead - 1 - (n % slot.ringCount) + 2 * RING_SIZE) % RING_SIZE];
}

/**
 * Row k of a clear dealt from the ring: the latest pieces in runs of two or three cells, each
 * lower row starting one piece further back. All 7 when no lock has been seen.
 */
function ringRow(slot, k, out, offset) {
    if (slot.ringCount === 0) {
        out.fill(PIECE_CODE.GARBAGE, offset, offset + COLUMNS);
        return;
    }
    const runs = Math.min(slot.ringCount, 4);
    for (let c = 0; c < COLUMNS; c += 1) out[offset + c] = ringAt(slot, k + Math.floor((c * runs) / COLUMNS));
}

/** Absolute row `key` as ten codes: what the well knows (unseen cells 7), else row k from the ring. */
function wellRow(slot, key, k, out, offset) {
    const e = wellFind(slot, key);
    if (e >= 0) {
        let known = 0;
        for (let c = 0; c < COLUMNS; c += 1) {
            const code = slot.wellCodes[e * COLUMNS + c];
            if (code === UNKNOWN) {
                out[offset + c] = PIECE_CODE.GARBAGE;
            } else {
                out[offset + c] = code;
                known += 1;
            }
        }
        if (known > 0) return;
    }
    ringRow(slot, k, out, offset);
}

/** Cleared rows leave the well; every row above drops by the number cleared beneath it. */
function wellCollapse(slot, rows) {
    const count = Math.min(rows.length, MAX_CLEARED);
    for (let e = 0; e < WELL_ROWS; e += 1) {
        if (slot.wellStamp[e] === 0) continue;
        const key = slot.wellKey[e];
        let below = 0;
        let cleared = false;
        for (let i = 0; i < count; i += 1) {
            const row = rows[i];
            if (!Number.isFinite(row) || rows.indexOf(row) !== i) continue;
            const r = Math.round(Number(row));
            if (r === key) cleared = true;
            else if (r > key) below += 1;
        }
        if (cleared) slot.wellStamp[e] = 0;
        else slot.wellKey[e] = key + below;
    }
}

/** A wave's absolute cleared rows into slot.sortRows, lowest on the board first, at most four. */
function sortCleared(slot, rows) {
    if (!Array.isArray(rows)) return 0;
    let n = 0;
    for (let i = 0; i < rows.length && i < MAX_CLEARED; i += 1) {
        if (!Number.isFinite(rows[i])) continue;
        const row = Math.round(Number(rows[i]));
        let at = n;
        while (at > 0 && slot.sortRows[at - 1] < row) at -= 1;
        if (at >= MAX_ROWS || (at > 0 && slot.sortRows[at - 1] === row)) continue;
        for (let j = Math.min(n, MAX_ROWS - 1); j > at; j -= 1) slot.sortRows[j] = slot.sortRows[j - 1];
        slot.sortRows[at] = row;
        if (n < MAX_ROWS) n += 1;
    }
    return n;
}

/**
 * The rows a clear names and what they were made of, read before the well collapses. Rows:
 * LINE_CLEAR viewportOrigin.y (Infinity) > the payload's cleared rows > the bottom rows, for
 * Odyssey's synthetic clears, which name none. A meditation click has a screen point instead.
 */
function captureClear(slot, payload, lines) {
    const known = sortCleared(slot, payload.clearedRows);
    const viewport = payload.viewportOrigin ? readLockViewportOrigin(payload) : null;
    let count = 0;
    if (viewport) {
        count = Math.min(MAX_ROWS, lines);
        const first = clampRow(Math.floor(viewport.y * BOARD_GRID.rows) - (lines - 1) * 0.5);
        for (let k = 0; k < count; k += 1) slot.clearRows[k] = clampRow(first + count - 1 - k);
    } else if (known > 0) {
        count = known;
        for (let k = 0; k < count; k += 1) slot.clearRows[k] = clampRow(slot.sortRows[k] - BOARD_GRID.hiddenRows);
    } else if (!hasPosition(payload.position)) {
        count = Math.min(MAX_ROWS, lines);
        for (let k = 0; k < count; k += 1) slot.clearRows[k] = BOARD_GRID.rows - 1 - k;
    }
    slot.clearRowCount = count;
    for (let k = 0; k < count; k += 1) {
        if (k < known) wellRow(slot, slot.sortRows[k], k, slot.clearCodes, k * COLUMNS);
        else ringRow(slot, k, slot.clearCodes, k * COLUMNS);
    }
}

function capturePosition(slot, payload) {
    const { position } = payload;
    if (hasPosition(position)) {
        slot.hasPosition = true;
        slot.posX = Number(position.x);
        slot.posY = Number(position.y);
    }
}

export class RainbarkDirector {
    /**
     * @param {{
     *   sink?: {
     *     lock?: Function, clear?: Function, spin?: Function, combo?: Function, b2b?: Function,
     *     levelUp?: Function,
     *   },
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
            distance: 0,
            color: null,
            shape: null,
            cells: null,
            screen: null,
        };
        this._cells = [0, 0, 0, 0, 0, 0, 0, 0];
        this._clear = {
            player: 0,
            rows: [],
            lines: 1,
            combo: 1,
            cascade: 1,
            tspin: false,
            perfect: false,
            b2b: false,
            crown: false,
            rowCodes: [],
            screen: null,
        };
        this._spin = { player: 0, rows: [], u: 0.5 };
        this._screen = { x: 0.5, y: 0.5 };
    }

    /**
     * Settings may change at any time. Disabling reactions drops everything staged, every combo,
     * every back-to-back run and every well, so re-enabling can never replay stale gameplay;
     * switching the lock ripple off cancels staged locks but keeps the clears.
     */
    configure(options = EMPTY) {
        if (options.lockRipple !== undefined) {
            this.lockRipple = options.lockRipple !== false;
            if (!this.lockRipple) {
                for (let i = 0; i < this.slots.length; i += 1) {
                    this.slots[i].lock = false;
                    this.slots[i].hardDrop = false;
                    this.slots[i].distance = 0;
                }
            }
        }
        if (options.enabled !== undefined) {
            const enabled = options.enabled !== false;
            if (this.enabled && !enabled) this.reset();
            this.enabled = enabled;
        }
    }

    /** Window size (CSS px) for normalising the meditation mode's click positions. */
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
        settleB2B(slot);
        slot.pending = true;
        slot.locked = true;
        slot.lock = this.lockRipple;
        // The piece before this one cleared nothing: the chain the sink knows of is over.
        if (slot.tracker.notePieceLocked() === 0 && slot.reported > 0) slot.broke = true;
        // Whatever the last lock left open, the tracker has caught up with it now.
        slot.breakSent = false;
        captureLock(slot, payload);
        wellLock(slot, payload.piece || EMPTY);
        return true;
    }

    /** Same tick as, and just BEFORE, the PIECE_LOCK of the same piece. */
    onHardDrop(event) {
        if (!this.enabled) return false;
        const payload = event || EMPTY;
        const slot = this.slotFor(payload);
        if (!slot) return false;
        slot.pending = true;
        slot.hardDrop = this.lockRipple;
        if (slot.hardDrop) slot.distance = Math.max(slot.distance, dropDistance(payload));
        captureLock(slot, payload);
        return true;
    }

    onLineClear(event) {
        if (!this.enabled) return false;
        const payload = event || EMPTY;
        const slot = this.slotFor(payload);
        if (!slot) return false;
        settleB2B(slot);
        slot.pending = true;
        // A clear that names its own combo (Odyssey's synthetic ones) is no cascade: the COMBO
        // that came before it carried that combo, not a depth.
        const synthetic = Number.isFinite(payload.comboCount);
        const named = Math.trunc(finite(payload.cascadeCount, 1));
        const cascade = Math.max(1, Math.min(255, Math.max(named, synthetic ? 1 : slot.stash)));
        slot.stash = 0;
        const rows = payload.clearedRows;
        const fallbackLines = Array.isArray(rows) && rows.length > 0 ? rows.length : 1;
        const lines = Math.max(1, Math.min(MAX_ROWS, Math.trunc(finite(payload.lineCount, fallbackLines))));
        if (slot.waves === 0 || lines > slot.lines) {
            // Several waves in one frame: the widest one names the rows.
            captureClear(slot, payload, lines);
        }
        if (Array.isArray(rows)) wellCollapse(slot, rows);
        slot.lines = Math.max(slot.lines, lines);
        slot.waves += 1;
        slot.cascade = Math.max(slot.cascade, cascade);
        // A clear of its own: a perfect clear staged before it in this frame rides on it.
        slot.crown = false;
        // A clear that turns up after its lock's frame (online play) picks the chain back up.
        slot.breakSent = false;
        slot.tracker.noteLineClear();
        // Only a difficult clear keeps a back-to-back run alive; a T-spin follows in this tick.
        if (cascade === 1 && lines < 4) slot.b2bCandidate = true;
        if (synthetic) slot.explicitCombo = Math.max(slot.explicitCombo, Math.trunc(Number(payload.comboCount)));
        capturePosition(slot, payload);
        return true;
    }

    /**
     * COMBO carries cascade DEPTH (fires once per wave >= 2, just before the wave's LINE_CLEAR),
     * never a combo: before a clear it is held for that clear, after one it deepens it. The
     * exceptions name a combo: a meditation click (it carries `position`), and the COMBO beside
     * a clear that names its own combo (Odyssey's goal flourish, its victory lap).
     */
    onCombo(event) {
        if (!this.enabled) return false;
        const payload = event || EMPTY;
        const slot = this.slotFor(payload);
        if (!slot) return false;
        const count = Math.max(0, Math.min(255, Math.trunc(finite(payload.comboCount, 0))));
        if (hasPosition(payload.position)) {
            slot.pending = true;
            slot.explicitCombo = Math.max(slot.explicitCombo, count);
            capturePosition(slot, payload);
            if (slot.lines === 0) slot.lines = 1;
            slot.crown = false;
        } else if (slot.waves > 0 && slot.explicitCombo >= 0) {
            slot.explicitCombo = Math.max(slot.explicitCombo, count);
        } else if (slot.waves > 0) {
            slot.cascade = Math.max(slot.cascade, count);
        } else {
            slot.stash = Math.max(slot.stash, count);
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
        // A T-spin clear is a difficult one: the back-to-back run lives on.
        slot.b2bCandidate = false;
        const lines = Math.max(0, Math.min(MAX_ROWS, Math.trunc(finite(payload.lineCount, 0))));
        if (lines > slot.lines) slot.lines = lines;
        if (lines > 0) slot.crown = false;
        return true;
    }

    onB2B(event) {
        if (!this.enabled) return false;
        const payload = event || EMPTY;
        if (payload.active === false) return false;
        const slot = this.slotFor(payload);
        if (!slot) return false;
        slot.b2b = true;
        slot.b2bCandidate = false;
        slot.b2bLevel = Math.min(MAX_B2B, slot.b2bLevel + 1);
        return true;
    }

    /** A later frame than the clears it crowns, on its own: the board is empty now. */
    onPerfectClear(event) {
        if (!this.enabled) return false;
        const slot = this.slotFor(event || EMPTY);
        if (!slot) return false;
        slot.pending = true;
        slot.perfect = true;
        if (slot.lines === 0) {
            // Settled after its clear's last wave: the crown on that clear, not a clear of its own.
            slot.lines = 1;
            slot.crown = true;
        }
        slot.wellStamp.fill(0);
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
        settleB2B(slot);
        slot.stash = 0;
        if (slot.broke) {
            slot.broke = false;
            if (slot.reported !== 0) {
                slot.reported = 0;
                sink?.combo?.(0, slot.player);
            }
        }
        // A lock's first clear lands in the tick it locks in: a lock with none has broken the chain.
        if (slot.locked && slot.lines === 0 && slot.reported > 0) slot.breakSent = true;
        const tracked = slot.breakSent ? 0 : slot.tracker.combo;
        const combo = Math.max(tracked, slot.lines > 0 ? Math.max(1, slot.explicitCombo) : 0);
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
        if (slot.b2bBroke) {
            slot.b2bBroke = false;
            if (slot.b2bReported !== 0) {
                slot.b2bReported = 0;
                sink?.b2b?.(0, slot.player);
            }
        }
        if (slot.b2bLevel !== slot.b2bReported) {
            slot.b2bReported = slot.b2bLevel;
            sink?.b2b?.(slot.b2bLevel, slot.player);
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
            c.player = slot.player;
            c.rows.length = 0;
            for (let r = 0; r < slot.lockRowCount; r += 1) c.rows.push(slot.lockRows[r]);
            c.u = slot.lockU;
            c.hardDrop = slot.hardDrop;
            c.distance = slot.hardDrop ? slot.distance : 0;
            c.color = slot.lockColor;
            c.shape = slot.lockShape;
            if (slot.hasCells) {
                for (let k = 0; k < 8; k += 1) this._cells[k] = slot.lockCells[k];
                c.cells = this._cells;
            } else c.cells = null;
            c.screen = null;
            sink.lock(c);
        }
        if (slot.lines > 0 && sink?.clear) {
            const c = this._clear;
            c.player = slot.player;
            c.rows.length = 0;
            c.rowCodes.length = 0;
            for (let r = 0; r < slot.clearRowCount; r += 1) {
                c.rows.push(slot.clearRows[r]);
                for (let k = 0; k < COLUMNS; k += 1) c.rowCodes.push(slot.clearCodes[r * COLUMNS + k]);
            }
            c.lines = slot.lines;
            c.combo = Math.max(1, combo);
            c.cascade = slot.cascade;
            c.tspin = slot.tspin;
            c.perfect = slot.perfect;
            c.b2b = slot.b2b;
            c.crown = slot.crown;
            c.screen = screen;
            sink.clear(c);
        } else if (slot.lines === 0 && slot.tspin && sink?.spin) {
            // A T-spin that cleared nothing still turns a little bark.
            const c = this._spin;
            c.player = slot.player;
            c.rows.length = 0;
            for (let r = 0; r < slot.lockRowCount; r += 1) c.rows.push(slot.lockRows[r]);
            c.u = slot.lockU;
            sink.spin(c);
        }
    }

    /**
     * A new run, or reactions switched off: drop everything staged, every combo, every
     * back-to-back run and every well.
     */
    reset() {
        for (let i = 0; i < this.slots.length; i += 1) {
            const slot = this.slots[i];
            const { player } = slot;
            clearPending(slot);
            clearWell(slot);
            slot.tracker.reset();
            slot.broke = false;
            slot.breakSent = false;
            slot.b2bLevel = 0;
            slot.b2bBroke = false;
            slot.b2bCandidate = false;
            slot.assigned = false;
            slot.player = 0;
            if (slot.reported !== 0) {
                slot.reported = 0;
                this.sink?.combo?.(0, player);
            }
            if (slot.b2bReported !== 0) {
                slot.b2bReported = 0;
                this.sink?.b2b?.(0, player);
            }
        }
        this.levelPending = false;
    }
}
