/**
 * @fileoverview Deterministic garbage system for multiplayer mode.
 * Handles garbage generation, queueing, serialization, and insertion.
 */

import { COLS, ROWS, HIDDEN_ROWS } from './constants.js';
import { rebuildBoardGridFromPieces, isPartOfPiece, findCompleteLines } from './board.js';
import { removeClearedLines, findConnectedComponents } from './cascade-helpers.js';
import { BLIND_PIECE_TICKS, fullBlindTicks } from './blind.js';

/**
 * What an attack's rows become on the target (versus attack styles):
 * - LINES: garbage rows.
 * - BLIND: no rows. Each normal row hides one of the target's next placed pieces (a 'blind'
 *   entry), and the clean bonus is a full blind of cleanRows x combo x FULL_BLIND_FACTOR.
 * - FULL_BLIND: no rows. Every cell on the target's board is hidden for
 *   rows x combo x FULL_BLIND_FACTOR blind ticks (rows: normal plus clean).
 */
export const ATTACK_TYPES = {
    LINES: 'lines',
    CLEAN: 'clean',
    BLIND: 'blind',
    FULL_BLIND: 'full_blind',
};

// Handicap / clean-garbage tuning constants
export const STAMP_PER_HANDICAP = 3; // Stamps needed to reduce 1 garbage line

/** Smallest attacking clear (matchConfig.minAttackLines): clears below it send no normal rows. */
export const MIN_ATTACK_LINES_DEFAULT = 2;
export const MIN_ATTACK_LINES_CHOICES = Object.freeze([2, 3, 4, 5]);

/**
 * The smallest clear that attacks, from a match config value (2 when unset or invalid).
 * @param {unknown} value
 * @returns {number}
 */
export function readMinAttackLines(value) {
    const lines = Number(value);
    return MIN_ATTACK_LINES_CHOICES.includes(lines) ? lines : MIN_ATTACK_LINES_DEFAULT;
}

/**
 * The rules calculateGarbage plays a versus match by, local and online: the attack style's
 * rules (matchConfig.attackRules) and the smallest attacking clear.
 * @param {{ attackRules?: Object|null, minAttackLines?: unknown }|null|undefined} matchConfig
 * @returns {Object}
 */
export function versusAttackRules(matchConfig) {
    return {
        ...(matchConfig?.attackRules || {}),
        minAttackLines: readMinAttackLines(matchConfig?.minAttackLines),
    };
}

// Clean-garbage column patterns (deterministic, alternating even/odd rows)
// Even rows: holes at columns [3, 6]
// Odd rows:  holes at columns [0, 3, 6, 9]
const CLEAN_PATTERN_EVEN = [3, 6];
const CLEAN_PATTERN_ODD = [0, 3, 6, 9];

/**
 * Hole-position encoding (MSB-first, inverse mapping)
 *
 * The encoding works as follows:
 * 1. When a piece is placed, moved[row][col] = true for cells occupied by the piece
 * 2. During line clearing, moved[row][col] is stored per cleared line
 * 3. Encoding: moved[j][i] → bit in bitfield (column 0 = bit 9, column 9 = bit 0)
 * 4. A '1' bit means HOLE in garbage, '0' bit means SOLID block
 *
 * This creates the inverse mapping: where your piece touched → holes in the opponent's
 * garbage, which is the core strategic mechanic of the versus mode.
 *
 * @param {Array<boolean>} mask - Boolean array where true = hole, false = solid
 * @returns {number} 10-bit value (0-1023) encoding hole positions
 */
export function maskArrayToBits(mask) {
    let bits = 0;
    // MSB-first: column 0 → bit 9, column 9 → bit 0
    for (let x = 0; x < COLS; x++) {
        bits <<= 1; // Shift left (MSB-first encoding)
        if (mask[x]) {
            bits |= 1; // Set bit if hole
        }
    }
    return bits;
}

/**
 * Decode hole-position bitfield to column array
 * @param {number} bits - 10-bit hole position bitfield
 * @returns {Array<number>} Array of column indices with holes
 */
export function bitsToColumns(bits) {
    const columns = [];
    // Decode MSB-first: test bit 9 first (column 0), then bit 8 (column 1), etc.
    for (let x = 0; x < COLS; x++) {
        const bitPos = COLS - 1 - x; // Map column to bit position (MSB-first)
        if ((bits & (1 << bitPos)) !== 0) {
            columns.push(x);
        }
    }
    return columns;
}

export function columnsToMask(columns) {
    const mask = Array(COLS).fill(false);
    if (Array.isArray(columns)) {
        columns.forEach((col) => {
            if (col >= 0 && col < COLS) {
                mask[col] = true;
            }
        });
    }
    return mask;
}

function normalizeMaskRow(row, manualColumns) {
    const fallbackColumns = manualColumns.length ? manualColumns : [Math.floor(COLS / 2)];
    const fallbackMask = columnsToMask(fallbackColumns);
    const safeFallback = fallbackMask.every((flag) => flag)
        ? columnsToMask([Math.floor(COLS / 2)])
        : fallbackMask;

    if (!row) {
        return safeFallback;
    }

    if (Array.isArray(row) && row.length === COLS && typeof row[0] === 'boolean') {
        const normalized = row.slice();
        const hasHole = normalized.some((flag) => flag);
        const allHoles = normalized.every((flag) => flag);
        if (!hasHole || allHoles) {
            return safeFallback;
        }
        return normalized;
    }

    if (Array.isArray(row)) {
        const mask = columnsToMask(row);
        const hasHole = mask.some((flag) => flag);
        const allHoles = mask.every((flag) => flag);
        if (!hasHole || allHoles) {
            return safeFallback.slice();
        }
        return mask;
    }

    return safeFallback;
}

function determineAttackType(rules = {}) {
    const forced = rules?.forceAttackType;
    return forced === ATTACK_TYPES.BLIND || forced === ATTACK_TYPES.FULL_BLIND
        ? forced
        : ATTACK_TYPES.LINES;
}

function cloneEntry(entry) {
    return JSON.parse(JSON.stringify(entry));
}

export class GarbageAttack {
    constructor({
        id = null,
        depth = 0,
        complexity = 0,
        rows = 0,
        holeMasks = [],
        cleanRowBonus = 0,
        cleanMasks = [],
        sendForPerfectClear = false,
        attackType = ATTACK_TYPES.LINES,
        param = 0,
        metadata = {},
    } = {}) {
        this.id = id;
        this.depth = depth;
        this.complexity = complexity;
        this.rows = rows;
        this.holeMasks = holeMasks;
        this.cleanRowBonus = cleanRowBonus;
        this.cleanMasks = cleanMasks;
        this.sendForPerfectClear = sendForPerfectClear;
        this.attackType = attackType;
        this.param = param;
        this.metadata = metadata;
    }

    withId(id) {
        this.id = id;
        return this;
    }

    getTotalLines() {
        return (this.cleanMasks?.length || 0) + (this.holeMasks?.length || 0);
    }

    /**
     * The queue entries this attack puts on one target (see ATTACK_TYPES): garbage rows, or
     * for the blind styles one 'blind' entry per hidden piece and a 'full_blind' entry with
     * its blind ticks.
     */
    expandEntries(context = {}) {
        const entries = [];
        const attackId = this.id || 'attack';
        const color = context.color || '#808080';
        const team = context.team || null;
        const attackerId = context.attackerId || null; // Track attacker for frag attribution
        const attackerName = context.attackerName || null; // Track attacker name directly
        const normalRows = this.holeMasks?.length || 0;
        const cleanRows = this.cleanMasks?.length || 0;
        const blindEntry = (type, ticks) => ({
            type,
            attackId,
            ticks,
            color,
            team,
            attackerId,
            attackerName,
            combo: this.complexity,
            depth: this.depth,
        });

        if (this.attackType === ATTACK_TYPES.BLIND) {
            for (let i = 0; i < normalRows; i++) entries.push(blindEntry('blind', BLIND_PIECE_TICKS));
            if (cleanRows > 0) entries.push(blindEntry('full_blind', fullBlindTicks(cleanRows, this.complexity)));
            return entries;
        }
        if (this.attackType === ATTACK_TYPES.FULL_BLIND) {
            const rows = normalRows + cleanRows;
            if (rows > 0) entries.push(blindEntry('full_blind', fullBlindTicks(rows, this.complexity)));
            return entries;
        }

        const totalLines = this.getTotalLines();
        let ordinal = 0;

        const pushLineEntry = (maskBits, variant) => {
            entries.push({
                type: 'line',
                attackId,
                variant,
                holeMask: maskBits,
                color,
                team,
                attackerId, // Store who sent this garbage line
                attackerName,
                connectAbove: ordinal > 0,
                connectBelow: ordinal < totalLines - 1,
                isLastInBurst: ordinal === totalLines - 1,
                combo: this.complexity,
                depth: this.depth,
            });
            ordinal++;
        };

        (this.cleanMasks || []).forEach((maskBits) => pushLineEntry(maskBits, 'clean'));
        (this.holeMasks || []).forEach((maskBits) => pushLineEntry(maskBits, 'normal'));

        return entries;
    }

    toJSON() {
        return {
            id: this.id,
            depth: this.depth,
            complexity: this.complexity,
            rows: this.rows,
            holeMasks: [...this.holeMasks],
            cleanRowBonus: this.cleanRowBonus,
            cleanMasks: [...this.cleanMasks],
            sendForPerfectClear: this.sendForPerfectClear,
            attackType: this.attackType,
            param: this.param,
            metadata: { ...this.metadata },
        };
    }

    static fromJSON(payload = {}) {
        return new GarbageAttack({
            id: payload.id || null,
            depth: payload.depth || 0,
            complexity: payload.complexity || 0,
            rows: payload.rows || 0,
            holeMasks: Array.isArray(payload.holeMasks) ? payload.holeMasks.slice() : [],
            cleanRowBonus: payload.cleanRowBonus || 0,
            cleanMasks: Array.isArray(payload.cleanMasks) ? payload.cleanMasks.slice() : [],
            sendForPerfectClear: !!payload.sendForPerfectClear,
            attackType: payload.attackType || ATTACK_TYPES.LINES,
            param: payload.param || 0,
            metadata: payload.metadata ? { ...payload.metadata } : {},
        });
    }
}

export function serializeAttack(attack) {
    if (!attack) return null;
    return attack.toJSON();
}

export function deserializeAttack(payload) {
    if (!payload) return null;
    return GarbageAttack.fromJSON(payload);
}

export function createGarbageAttackFromColumns({
    rows = 0,
    columns = [Math.floor(COLS / 2)],
    columnsByRow = null,
    attackType = ATTACK_TYPES.LINES,
    param = 0,
    metadata = {},
} = {}) {
    const safeRows = Math.max(0, Math.floor(rows));
    const fallbackColumns = Array.isArray(columns) && columns.length
        ? columns
        : [Math.floor(COLS / 2)];
    const holeMasks = [];

    for (let i = 0; i < safeRows; i++) {
        const rowColumns = Array.isArray(columnsByRow?.[i]) && columnsByRow[i].length
            ? columnsByRow[i]
            : fallbackColumns;
        holeMasks.push(maskArrayToBits(columnsToMask(rowColumns)));
    }

    return new GarbageAttack({
        depth: safeRows + 1,
        complexity: 1,
        rows: safeRows,
        holeMasks,
        attackType,
        param,
        metadata,
    });
}

/**
 * Apply the handicap system
 * Higher handicap players accumulate stamps that reduce their outgoing attacks
 * @param {number} rows - Base number of garbage rows
 * @param {Object} senderState - Sender's game state with handicap info
 * @param {string} opponentId - Opponent identifier
 * @param {boolean} isClean - Whether this is a clean attack (clean attacks bypass handicap)
 * @returns {number} Adjusted number of rows after handicap
 */
export function applyHandicap(rows, senderState, opponentId, isClean = false) {
    if (isClean || !senderState || rows <= 0) {
        return rows;
    }

    let adjustedRows = rows;
    const stamps = senderState.handicaps[opponentId] || 0;

    // Consume stamps to reduce outgoing lines
    let stampsUsed = 0;
    while (adjustedRows > 0 && stamps - stampsUsed >= STAMP_PER_HANDICAP) {
        adjustedRows--;
        stampsUsed += STAMP_PER_HANDICAP;
    }

    // Update sender's stamp count
    if (stampsUsed > 0) {
        senderState.handicaps[opponentId] = stamps - stampsUsed;
    }

    return adjustedRows;
}

/**
 * Accumulate handicap stamps (called after each piece placement)
 * @param {Object} playerState - Player's game state
 * @param {Object} opponents - Map of opponent IDs to their game states
 */
export function accumulateHandicapStamps(playerState, opponents) {
    if (!playerState) return;

    // Accumulate per-opponent stamps
    for (const [opponentId, opponentState] of Object.entries(opponents)) {
        if (!opponentState) continue;

        const diff = Math.max(0, playerState.handicap - opponentState.handicap);
        const maxStamps = diff * STAMP_PER_HANDICAP;

        if (!playerState.handicaps[opponentId]) {
            playerState.handicaps[opponentId] = 0;
        }

        if (playerState.handicaps[opponentId] < maxStamps) {
            playerState.handicaps[opponentId]++;
        }
    }
}

/**
 * Calculate garbage attack from cascade summary
 *
 * Attack formula:
 * 1. Base attack lines:  depth - 1, or none when depth is below rules.minAttackLines
 *    (the smallest attacking clear, 2 by default)
 * 2. Clean bonus:        (1 + depth) / 2  (integer division), always sent
 * 3. Total attack:       base + clean_bonus (if clean)
 *
 * EXAMPLES:
 * - 1 line cleared (single):  0 attack lines (1-1=0)
 * - 2 lines (double):         1 attack line  (2-1=1)
 * - 3 lines (triple):         2 attack lines (3-1=2)
 * - 4 lines (quad):           3 attack lines (4-1=3)
 * - 3 lines + clean:          2 + 2 = 4 attack lines
 * - 4 lines + clean:          3 + 2 = 5 attack lines
 *
 * @param {Object} summary - Cascade summary from physics
 * @param {Object} rules - Optional override rules
 * @returns {GarbageAttack} Attack object with encoded hole positions
 */
export function calculateGarbage(summary, rules = {}) {
    if (!summary) {
        return new GarbageAttack({});
    }

    const depth = summary.depth ?? summary.totalLines ?? 0;
    const complexity = summary.complexity ?? summary.comboStages ?? 0;
    const rawMask = summary.holeMask ?? summary.holeMaskBuffer ?? [];
    const manualColumns = summary.manualColumns || [];
    const maskMatrix = rawMask.map((row) => normalizeMaskRow(row, manualColumns));

    // Base attack = depth - 1, from the smallest attacking clear up.
    const rowsToSend = depth >= readMinAttackLines(rules?.minAttackLines) ? Math.max(0, depth - 1) : 0;
    const holeMasks = maskMatrix.slice(0, rowsToSend).map(maskArrayToBits);

    const sendForPerfectClear = !!summary.sendForPerfectClear;
    // Clean bonus = (1 + depth) / 2 (integer division)
    const cleanRowBonus = sendForPerfectClear ? Math.floor((1 + depth) / 2) : 0;

    // Generate clean garbage patterns (alternating even/odd column masks)
    const cleanMasks = [];
    for (let i = 0; i < cleanRowBonus; i++) {
        const pattern = i % 2 === 0 ? CLEAN_PATTERN_EVEN : CLEAN_PATTERN_ODD;
        cleanMasks.push(maskArrayToBits(columnsToMask(pattern)));
    }

    const attackType = determineAttackType(rules);

    return new GarbageAttack({
        depth,
        complexity,
        rows: rowsToSend,
        holeMasks,
        cleanRowBonus,
        cleanMasks,
        sendForPerfectClear,
        attackType,
        metadata: {
            manualColumns: manualColumns.slice(),
            sourceColor: summary.sourceColor || null,
            sourcePiece: summary.sourcePiece || null,
            sequence: summary.sequence,
        },
    });
}

function getHighestOccupiedRow(board) {
    if (!board) {
        return ROWS + HIDDEN_ROWS;
    }

    for (let y = 0; y < board.length; y++) {
        if (board[y].some((cell) => cell !== null)) {
            return y;
        }
    }

    return board.length;
}

function generateGarbageBoard(lockedPieces, totalRows) {
    const grid = Array.from({ length: totalRows }, () => Array(COLS).fill(null));
    return rebuildBoardGridFromPieces(lockedPieces, grid);
}

/**
 * Let unsupported pieces settle after garbage pushes the stack upward.
 * This prevents situations where existing blocks remain suspended above the
 * newly-created garbage holes (see: floating orange piece bug report).
 *
 * @param {Array<Object>} lockedPieces - Current locked pieces (mutated)
 * @param {number} totalRows - Current playfield height
 * @returns {number} Number of single-row fall steps that occurred
 */
function settleFloatingBlocksAfterGarbage(lockedPieces, totalRows) {
    if (!Array.isArray(lockedPieces) || lockedPieces.length === 0) {
        return 0;
    }

    const hasSolidCells = (piece) => piece?.shape?.some((row) => (
        Array.isArray(row) && row.some((cell) => cell > 0)
    ));

    for (let i = lockedPieces.length - 1; i >= 0; i--) {
        if (!hasSolidCells(lockedPieces[i])) {
            lockedPieces.splice(i, 1);
        }
    }

    let totalSteps = 0;
    let blocksStillFalling = true;

    while (blocksStillFalling) {
        blocksStillFalling = false;
        const board = generateGarbageBoard(lockedPieces, totalRows);
        const piecesToCheck = lockedPieces
            .filter((piece) => piece && Array.isArray(piece.shape) && piece.shape.length > 0)
            .sort((a, b) => {
                const aHeight = Array.isArray(a.shape) ? a.shape.length : 0;
                const bHeight = Array.isArray(b.shape) ? b.shape.length : 0;
                const aY = typeof a.y === 'number' ? a.y : 0;
                const bY = typeof b.y === 'number' ? b.y : 0;
                return bY + bHeight - (aY + aHeight);
            });

        for (const piece of piecesToCheck) {
            if (!piece || !Array.isArray(piece.shape) || piece.shape.length === 0) {
                continue;
            }

            let canFall = true;

            const originX = typeof piece.x === 'number' ? piece.x : 0;
            const originY = typeof piece.y === 'number' ? piece.y : 0;

            for (let localY = piece.shape.length - 1; localY >= 0 && canFall; localY--) {
                const row = piece.shape[localY];
                if (!Array.isArray(row)) continue;

                for (let localX = 0; localX < row.length; localX++) {
                    if (row[localX] <= 0) continue;

                    const boardX = originX + localX;
                    const boardY = originY + localY + 1;

                    if (boardY >= board.length) {
                        canFall = false;
                        break;
                    }

                    const occupant = board[boardY]?.[boardX] ?? null;
                    if (occupant !== null && !isPartOfPiece(boardX, boardY, piece)) {
                        canFall = false;
                        break;
                    }
                }
            }

            if (canFall) {
                piece.y = originY + 1;
                totalSteps++;
                blocksStillFalling = true;
            }
        }
    }

    return totalSteps;
}

/** Mark the cells of every full row on the board. */
function markFullRowCells(board) {
    const marks = board.map((row) => row.map(() => false));
    findCompleteLines(board, 0).forEach((y) => marks[y].fill(true));
    return marks;
}

/** Carry each cell's mark down with the piece the settle moved (only piece.y changes). */
function followSettledPieces(marks, lockedPieces, startY) {
    const moved = marks.map((row) => row.map(() => false));
    for (const piece of lockedPieces) {
        const fromY = startY.get(piece) ?? piece.y;
        piece.shape.forEach((row, localY) => {
            row.forEach((cell, localX) => {
                if (cell <= 0) return;
                const x = piece.x + localX;
                const toRow = moved[Math.floor(piece.y + localY)];
                if (toRow && x >= 0 && x < COLS) {
                    toRow[x] = marks[Math.floor(fromY + localY)]?.[x] ?? false;
                }
            });
        });
    }
    return moved;
}

/** Mark the cells of every piece the settle moved, at the place it came to rest. */
function markMovedCells(lockedPieces, startY, totalRows) {
    const moved = Array.from({ length: totalRows }, () => Array(COLS).fill(false));
    for (const piece of lockedPieces) {
        if ((startY.get(piece) ?? piece.y) === piece.y) continue;
        piece.shape.forEach((row, localY) => {
            row.forEach((cell, localX) => {
                const x = piece.x + localX;
                const toRow = moved[Math.floor(piece.y + localY)];
                if (cell > 0 && toRow && x >= 0 && x < COLS) toRow[x] = true;
            });
        });
    }
    return moved;
}

/**
 * Settle the stack over fresh garbage, then clear every row that settle completed and settle
 * again, until a settle completes nothing. A body dropping into the holes of incoming garbage
 * can close rows; they go at once. Each pass is one wave of that clear: `waves` lists its rows
 * and, per row, the cells that fell into it (the holes such a clear would send). Whether the
 * player is credited for them is the caller's rule (applyGarbage, creditSettleClears).
 *
 * A row that was already full before the settle (solid garbage) is not the settle's doing and
 * stays for the next lock, as it always has. Its cells keep that mark as they fall, so it is
 * still told apart if the settle drops it onto a row the settle completed.
 *
 * Removing rows and splitting what is left use the lock cascade's own helpers; lock-time
 * cascades themselves are untouched.
 *
 * @param {Array<Object>} lockedPieces - Current locked pieces (contents replaced in place)
 * @param {number} totalRows - Current playfield height
 * @param {number} firstPlayableRow - First row a line clear may take
 * @returns {{settledSteps: number, clearedRows: number[],
 *   waves: Array<{rows: number[], holeMasks: boolean[][]}>}}
 */
function settleAndClearCompletedRows(lockedPieces, totalRows, firstPlayableRow) {
    // Cells that sat in a full row before the first settle; the marks travel with their pieces.
    let alreadyFull = markFullRowCells(generateGarbageBoard(lockedPieces, totalRows));
    let settledSteps = 0;
    const clearedRows = [];
    const waves = [];

    for (;;) {
        const startY = new Map(lockedPieces.map((piece) => [piece, piece.y]));
        settledSteps += settleFloatingBlocksAfterGarbage(lockedPieces, totalRows);
        const carried = followSettledPieces(alreadyFull, lockedPieces, startY);
        alreadyFull = carried;

        const board = generateGarbageBoard(lockedPieces, totalRows);
        const completed = findCompleteLines(board, firstPlayableRow)
            .filter((y) => carried[y].some((marked) => !marked));
        if (completed.length === 0) break;

        const moved = markMovedCells(lockedPieces, startY, totalRows);
        waves.push({ rows: completed.slice(), holeMasks: completed.map((y) => moved[y].slice()) });
        clearedRows.push(...completed);
        const survivors = removeClearedLines(lockedPieces, completed);
        const fragments = findConnectedComponents(generateGarbageBoard(survivors, totalRows));
        // Callers hold lockedPieces by alias: replace the contents, never the array.
        lockedPieces.splice(0, lockedPieces.length, ...fragments);
    }

    return { settledSteps, clearedRows, waves };
}

/**
 * Drop every cell the rise lifted above the board's top row (versus overflow). Pieces that
 * lose cells are split again, so what is left of each falls as its own body.
 * @param {Array<Object>} lockedPieces - Current locked pieces (contents replaced in place)
 * @param {number} totalRows - Current playfield height
 * @returns {number} cells dropped
 */
function dropCellsAboveTop(lockedPieces, totalRows) {
    let dropped = 0;
    const kept = [];
    const cut = [];
    for (const piece of lockedPieces) {
        let lost = 0;
        const shape = piece.shape.map((row, localY) => {
            if (Math.floor(piece.y + localY) >= 0) return row;
            lost += row.filter((cell) => cell > 0).length;
            return row.map(() => 0);
        });
        if (lost === 0) {
            kept.push(piece);
            continue;
        }
        dropped += lost;
        if (shape.some((row) => row.some((cell) => cell > 0))) cut.push({ ...piece, shape });
    }
    if (dropped === 0) return 0;
    const fragments = cut.length > 0
        ? findConnectedComponents(generateGarbageBoard(cut, totalRows))
        : [];
    // Callers hold lockedPieces by alias: replace the contents, never the array.
    lockedPieces.splice(0, lockedPieces.length, ...kept, ...fragments);
    return dropped;
}

/**
 * Insert garbage entries into the playfield with animation support
 *
 * CRITICAL: Hole decoding must match the wire hole-encoding used by maskArrayToBits:
 * - holeMask bitfield is decoded MSB-first
 * - Bit 9 → column 0, Bit 8 → column 1, ..., Bit 0 → column 9
 * - 1 bit = HOLE (empty cell), 0 bit = SOLID (garbage block)
 *
 * Overflow: by default ('refuse') a burst that would lift any cell above the visible rows is
 * not inserted and reports topOut. Versus play passes overflowPolicy 'spill': the burst always
 * goes in, cells lifted past the board's top row are lost, and only a blocked spawn ends the
 * player (Infinity keeps its own roof rule either way).
 *
 * @param {Array<Object>} lockedPieces - Array of locked pieces (modified)
 * @param {Array<Object>} entries - Garbage entries to insert
 * @param {Object} options - Optional animation settings and overflowPolicy ('refuse' | 'spill')
 * @returns {Object} Result with success, topOut flags, and animation data. linesAfterInsertion
 *   lists the full rows left on the board; settleClearedRows lists the rows the settle
 *   completed and cleared before returning, and settleWaves the same rows wave by wave with
 *   their hole masks; overflowCells counts the cells a spill dropped.
 */
export function insertGarbageEntries(lockedPieces, entries, options = {}) {
    const { boardGrid, isInfinityMode = false, debug = false } = options;
    const spill = options.overflowPolicy === 'spill' && !isInfinityMode;
    const log = debug ? console.log : () => { };
    const warn = debug ? console.warn : () => { };
    const lineEntries = entries.filter((entry) => entry.type === 'line');
    if (lineEntries.length === 0) {
        return {
            success: true,
            topOut: false,
            garbagePieces: [],
            settledSteps: 0,
            linesAfterInsertion: [],
            settleClearedRows: [],
            settleWaves: [],
            overflowCells: 0,
        };
    }

    log('[insertGarbageEntries] ========================================');
    log(`[insertGarbageEntries] Inserting ${lineEntries.length} garbage row(s)`);

    // The grid supplies dimensions; lockedPieces supplies current occupancy.
    // Reusing its cells would read stale positions both before and after insertion.
    const totalRows = boardGrid?.length || (ROWS + HIDDEN_ROWS);
    const board = generateGarbageBoard(lockedPieces, totalRows);
    const highestOccupiedRow = getHighestOccupiedRow(board);
    const newHighestRow = highestOccupiedRow - lineEntries.length;

    log(
        `[insertGarbageEntries] Highest row: ${highestOccupiedRow}, New highest: ${newHighestRow}, Hidden rows: ${HIDDEN_ROWS}, Total rows: ${totalRows}`,
    );

    if (!spill && (isInfinityMode ? newHighestRow <= 0 : newHighestRow < HIDDEN_ROWS)) {
        log('[insertGarbageEntries] TOP OUT detected while inserting garbage burst');
        return {
            success: false,
            topOut: true,
            garbagePieces: [],
            settledSteps: 0,
            linesAfterInsertion: [],
            settleClearedRows: [],
            settleWaves: [],
            overflowCells: 0,
        };
    }

    // Shift existing pieces up
    lockedPieces.forEach((piece) => {
        piece.y -= lineEntries.length;
    });
    const overflowCells = spill && newHighestRow < 0 ? dropCellsAboveTop(lockedPieces, totalRows) : 0;
    if (overflowCells > 0) {
        log(`[insertGarbageEntries] Spill dropped ${overflowCells} cell(s) lifted past the top`);
    }

    const baseY = totalRows - lineEntries.length;
    const garbagePieces = [];

    lineEntries.forEach((entry, index) => {
        const y = baseY + index;
        let holeColumns = bitsToColumns(entry.holeMask);
        if (holeColumns.length === COLS) {
            const fallbackColumn = Math.floor(COLS / 2);
            warn(
                '[insertGarbageEntries] All-hole garbage row detected; applying fallback hole column',
                fallbackColumn,
            );
            holeColumns = [fallbackColumn];
        }
        const holeSet = new Set(holeColumns);
        const row = [];

        // Build row: 0 = hole (empty), 1 = solid garbage block
        for (let x = 0; x < COLS; x++) {
            row.push(holeSet.has(x) ? 0 : 1);
        }

        const solidCols = [];
        for (let x = 0; x < COLS; x++) {
            if (!holeSet.has(x)) solidCols.push(x);
        }

        log(`[insertGarbageEntries] Row ${index + 1}/${lineEntries.length}:`);
        log(
            `[insertGarbageEntries]   holeMask bits: ${entry.holeMask.toString(2).padStart(COLS, '0')} (${entry.holeMask})`,
        );
        log(`[insertGarbageEntries]   holes at columns: [${holeColumns.join(', ')}]`);
        log(`[insertGarbageEntries]   solid at columns: [${solidCols.join(', ')}]`);
        log(`[insertGarbageEntries]   variant: ${entry.variant || 'normal'}`);

        const garbagePiece = {
            shapeKey: entry.variant === 'clean' ? 'CLEAN_GARBAGE' : 'GARBAGE',
            shape: [row],
            x: 0,
            y,
            color: entry.color || '#808080',
            pieceId: `${entry.attackId || 'garbage'}-${index}`,
            isGarbage: true,
            garbageMeta: {
                attackId: entry.attackId || null,
                variant: entry.variant || 'normal',
                connectTop: !!entry.connectAbove,
                connectBottom: !!entry.connectBelow,
                combo: entry.combo,
                depth: entry.depth,
            },
            // Animation data
            animationOffset: options.animated ? lineEntries.length : 0,
            isAnimating: options.animated || false,
        };

        lockedPieces.push(garbagePiece);
        garbagePieces.push(garbagePiece);
    });

    const firstPlayableRow = isInfinityMode ? 0 : HIDDEN_ROWS;
    let settledSteps = 0;
    let settleClearedRows = [];
    let settleWaves = [];
    if (options.settleFloatingBlocks !== false) {
        ({ settledSteps, clearedRows: settleClearedRows, waves: settleWaves } = settleAndClearCompletedRows(
            lockedPieces,
            totalRows,
            firstPlayableRow,
        ));
        if (settledSteps > 0) {
            log(
                `[insertGarbageEntries] Settled floating blocks with ${settledSteps} fall step(s)`,
            );
        }
        if (settleClearedRows.length > 0) {
            log(
                `[insertGarbageEntries] Cleared ${settleClearedRows.length} settle-completed row(s)`,
            );
        }
    }

    const postBoard = generateGarbageBoard(lockedPieces, totalRows);
    const linesAfterInsertion = findCompleteLines(postBoard, firstPlayableRow);

    log('[insertGarbageEntries] ========================================');
    return {
        success: true,
        topOut: false,
        garbagePieces,
        settledSteps,
        linesAfterInsertion,
        settleClearedRows,
        settleWaves,
        overflowCells,
    };
}

export class GarbageQueue {
    /**
     * @param {{ maxLines?: number }} [options] maxLines: most rows that may wait at once; rows
     *   sent past it are dropped (versus play: VERSUS_MAX_PENDING_LINES).
     */
    constructor({ maxLines = Infinity } = {}) {
        this.entries = [];
        this.maxLines = maxLines > 0 ? maxLines : Infinity;
    }

    enqueue(entries) {
        if (!entries) return;
        if (Array.isArray(entries)) {
            entries.forEach((entry) => this._push(entry));
            return;
        }
        this._push(entries);
    }

    _push(entry) {
        const capped = entry?.type === 'line' || entry?.type === 'blind';
        if (capped && this.getCappedCount() >= this.maxLines) {
            if (entry.type !== 'line') return;
            // The burst this row belonged to now ends at the last of its rows that got in.
            const last = this.entries[this.entries.length - 1];
            if (last?.type === 'line' && last.attackId === entry.attackId && !last.isLastInBurst) {
                last.isLastInBurst = true;
                last.connectBelow = false;
            }
            return;
        }
        this.entries.push(cloneEntry(entry));
    }

    enqueueAttack(attack, context = {}) {
        if (!attack) return;
        const entries = attack.expandEntries(context);
        this.enqueue(entries);
    }

    getTotalLines() {
        return this.entries.reduce((sum, entry) => (entry.type === 'line' ? sum + 1 : sum), 0);
    }

    /** Pending blind pieces ('blind' entries). */
    getBlindPieceCount() {
        return this.entries.reduce((sum, entry) => (entry.type === 'blind' ? sum + 1 : sum), 0);
    }

    /** Entries that count toward maxLines: rows and blind pieces (full blinds do not). */
    getCappedCount() {
        return this.entries.reduce(
            (sum, entry) => (entry.type === 'line' || entry.type === 'blind' ? sum + 1 : sum),
            0,
        );
    }

    isEmpty() {
        return this.entries.length === 0;
    }

    /**
     * Take the first burst of rows waiting. Blind entries ahead of it never hold it back: they
     * wait for placed pieces (blind.js takeSpawnBlinds), the rows go in at the next spawn.
     */
    dequeueLineBurst() {
        const start = this.entries.findIndex((entry) => entry.type === 'line');
        if (start < 0) {
            return [];
        }

        let end = start;
        while (end < this.entries.length && this.entries[end].type === 'line') {
            end++;
            if (this.entries[end - 1].isLastInBurst) {
                break;
            }
        }
        return this.entries.splice(start, end - start);
    }

    clear() {
        this.entries = [];
    }

    serialize() {
        return this.entries.map((entry) => cloneEntry(entry));
    }

    static fromSerialized(payload, options) {
        const queue = new GarbageQueue(options);
        if (Array.isArray(payload)) {
            payload.forEach((entry) => queue.enqueue(entry));
        }
        return queue;
    }
}
