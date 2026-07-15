/**
 * @fileoverview Deterministic garbage system for multiplayer mode.
 * Handles garbage generation, queueing, serialization, and insertion.
 */

import { COLS, ROWS, HIDDEN_ROWS } from './constants.js';
import { generateBoard, isPartOfPiece, findCompleteLines } from './board.js';

export const ATTACK_TYPES = {
    LINES: 'lines',
    CLEAN: 'clean',
    BLIND: 'blind',
    FULL_BLIND: 'full_blind',
    POTATO: 'potato',
};

// Handicap levels
export const HANDICAP_LEVELS = {
    BEGINNER: 0, // "-" - Easiest
    APPRENTICE: 1, // "A"
    INTERMEDIATE: 2, // Default
    MASTER: 3, // "M"
    GRANDMASTER: 4, // "+" - Hardest
};

// Handicap / clean-garbage tuning constants
export const STAMP_PER_HANDICAP = 3; // Stamps needed to reduce 1 garbage line
export const CROWD_THRESHOLD = 4; // Players before crowd handicap kicks in
export const DEFAULT_POTATO_DURATION_MS = 12000;
export const DEFAULT_POTATO_PENALTY_LINES = 6;

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

function determineAttackType(depth, complexity, cleanBonus, rules = {}) {
    if (rules && rules.forceAttackType) {
        return rules.forceAttackType;
    }
    // Placeholder: default to line-based attack
    return ATTACK_TYPES.LINES;
}

function determineAttackParam(attackType, depth, complexity, rules = {}) {
    if (rules && typeof rules.attackParam === 'number') {
        return rules.attackParam;
    }
    if (attackType === ATTACK_TYPES.BLIND) {
        return Math.max(0, (rules.blindBaseDuration || 3) + complexity);
    }
    if (attackType === ATTACK_TYPES.FULL_BLIND) {
        return Math.max(0, depth * (rules.fullBlindMultiplier || 2));
    }
    if (attackType === ATTACK_TYPES.POTATO) {
        return Math.max(1000, rules.potatoDurationMs || DEFAULT_POTATO_DURATION_MS);
    }
    return 0;
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
        cleanBonus = 0,
        cleanMasks = [],
        sendForClean = false,
        attackType = ATTACK_TYPES.LINES,
        param = 0,
        metadata = {},
    } = {}) {
        this.id = id;
        this.depth = depth;
        this.complexity = complexity;
        this.rows = rows;
        this.holeMasks = holeMasks;
        this.cleanBonus = cleanBonus;
        this.cleanMasks = cleanMasks;
        this.sendForClean = sendForClean;
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

    expandEntries(context = {}) {
        const entries = [];
        const attackId = this.id || 'attack';
        const color = context.color || '#808080';
        const team = context.team || null;
        const attackerId = context.attackerId || null; // Track attacker for frag attribution
        const attackerName = context.attackerName || null; // Track attacker name directly

        if (this.attackType === ATTACK_TYPES.BLIND && this.param > 0) {
            entries.push({
                type: 'blind',
                attackId,
                duration: this.param,
                combo: this.complexity,
                depth: this.depth,
                attackerId,
            });
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
                blindTime: 0,
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

        if (this.attackType === ATTACK_TYPES.FULL_BLIND && this.param > 0) {
            entries.push({
                type: 'full_blind',
                attackId,
                attackerId,
                duration: this.param,
                combo: this.complexity,
                depth: this.depth,
            });
        }

        return entries;
    }

    toJSON() {
        return {
            id: this.id,
            depth: this.depth,
            complexity: this.complexity,
            rows: this.rows,
            holeMasks: [...this.holeMasks],
            cleanBonus: this.cleanBonus,
            cleanMasks: [...this.cleanMasks],
            sendForClean: this.sendForClean,
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
            cleanBonus: payload.cleanBonus || 0,
            cleanMasks: Array.isArray(payload.cleanMasks) ? payload.cleanMasks.slice() : [],
            sendForClean: !!payload.sendForClean,
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
 * Apply crowd handicap (for games with 5+ players)
 * @param {number} rows - Base number of garbage rows
 * @param {Object} senderState - Sender's game state
 * @param {number} aliveCount - Number of alive players
 * @param {boolean} isClean - Whether this is a clean attack
 * @returns {number} Adjusted number of rows after crowd handicap
 */
export function applyCrowdHandicap(rows, senderState, aliveCount, isClean = false) {
    if (isClean || !senderState || rows <= 0 || aliveCount <= CROWD_THRESHOLD) {
        return rows;
    }

    let adjustedRows = rows;
    let crowdStamps = senderState.handicapCrowd || 0;

    // Consume crowd stamps
    while (adjustedRows > 0 && crowdStamps >= STAMP_PER_HANDICAP) {
        adjustedRows--;
        crowdStamps -= STAMP_PER_HANDICAP;
    }

    // Update crowd stamps
    senderState.handicapCrowd = crowdStamps;

    return adjustedRows;
}

/**
 * Accumulate handicap stamps (called after each piece placement)
 * @param {Object} playerState - Player's game state
 * @param {Object} opponents - Map of opponent IDs to their game states
 * @param {number} aliveCount - Number of alive players
 */
export function accumulateHandicapStamps(playerState, opponents, aliveCount) {
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

    // Accumulate crowd handicap stamps
    const maxCrowdStamps = Math.max(0, aliveCount - CROWD_THRESHOLD) * STAMP_PER_HANDICAP;

    if (playerState.handicapCrowd < maxCrowdStamps) {
        playerState.handicapCrowd++;
    } else {
        playerState.handicapCrowd = maxCrowdStamps;
    }
}

/**
 * Calculate garbage attack from cascade summary
 *
 * Attack formula:
 * 1. Base attack lines:  depth - 1
 * 2. Clean bonus:        (1 + depth) / 2  (integer division)
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

    // Base attack = depth - 1
    const rowsToSend = Math.max(0, depth - 1);
    const holeMasks = maskMatrix.slice(0, rowsToSend).map(maskArrayToBits);

    const sendForClean = !!summary.sendForClean;
    // Clean bonus = (1 + depth) / 2 (integer division)
    const cleanBonus = sendForClean ? Math.floor((1 + depth) / 2) : 0;

    // Generate clean garbage patterns (alternating even/odd column masks)
    const cleanMasks = [];
    for (let i = 0; i < cleanBonus; i++) {
        const pattern = i % 2 === 0 ? CLEAN_PATTERN_EVEN : CLEAN_PATTERN_ODD;
        cleanMasks.push(maskArrayToBits(columnsToMask(pattern)));
    }

    const attackType = determineAttackType(depth, complexity, cleanBonus, rules);
    const param = determineAttackParam(attackType, depth, complexity, rules);

    return new GarbageAttack({
        depth,
        complexity,
        rows: rowsToSend,
        holeMasks,
        cleanBonus,
        cleanMasks,
        sendForClean,
        attackType,
        param,
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

/**
 * Let unsupported pieces settle after garbage pushes the stack upward.
 * This prevents situations where existing blocks remain suspended above the
 * newly-created garbage holes (see: floating orange piece bug report).
 *
 * @param {Array<Object>} lockedPieces - Current locked pieces (mutated)
 * @returns {number} Number of single-row fall steps that occurred
 */
function settleFloatingBlocksAfterGarbage(lockedPieces) {
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
        const board = generateBoard(lockedPieces);
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

/**
 * Insert garbage entries into the playfield with animation support
 *
 * CRITICAL: Hole decoding must match Quadra's encoding:
 * - holeMask bitfield is decoded MSB-first
 * - Bit 9 → column 0, Bit 8 → column 1, ..., Bit 0 → column 9
 * - 1 bit = HOLE (empty cell), 0 bit = SOLID (garbage block)
 *
 * @param {Array<Object>} lockedPieces - Array of locked pieces (modified)
 * @param {Array<Object>} entries - Garbage entries to insert
 * @param {Object} options - Optional animation settings
 * @returns {Object} Result with success, topOut flags, and animation data
 */
export function insertGarbageEntries(lockedPieces, entries, options = {}) {
    const { boardGrid, debug = false } = options;
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
        };
    }

    log('[insertGarbageEntries] ========================================');
    log(`[insertGarbageEntries] Inserting ${lineEntries.length} garbage row(s)`);

    const board = generateBoard(lockedPieces, { boardGrid });
    const totalRows = board.length;
    const highestOccupiedRow = getHighestOccupiedRow(board);
    const newHighestRow = highestOccupiedRow - lineEntries.length;

    log(
        `[insertGarbageEntries] Highest row: ${highestOccupiedRow}, New highest: ${newHighestRow}, Hidden rows: ${HIDDEN_ROWS}, Total rows: ${totalRows}`,
    );

    if (newHighestRow < HIDDEN_ROWS) {
        log('[insertGarbageEntries] TOP OUT detected while inserting garbage burst');
        return {
            success: false,
            topOut: true,
            garbagePieces: [],
            settledSteps: 0,
            linesAfterInsertion: [],
        };
    }

    // Shift existing pieces up
    lockedPieces.forEach((piece) => {
        piece.y -= lineEntries.length;
    });

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

    let settledSteps = 0;
    if (options.settleFloatingBlocks !== false) {
        settledSteps = settleFloatingBlocksAfterGarbage(lockedPieces);
        if (settledSteps > 0) {
            log(
                `[insertGarbageEntries] Settled floating blocks with ${settledSteps} fall step(s)`,
            );
        }
    }

    const postBoard = generateBoard(lockedPieces, { boardGrid });
    const linesAfterInsertion = findCompleteLines(postBoard).filter((y) => y >= HIDDEN_ROWS);

    log('[insertGarbageEntries] ========================================');
    return {
        success: true,
        topOut: false,
        garbagePieces,
        settledSteps,
        linesAfterInsertion,
    };
}

export class GarbageQueue {
    constructor() {
        this.entries = [];
    }

    enqueue(entries) {
        if (!entries) return;
        if (Array.isArray(entries)) {
            entries.forEach((entry) => this.entries.push(cloneEntry(entry)));
            return;
        }
        this.entries.push(cloneEntry(entries));
    }

    enqueueAttack(attack, context = {}) {
        if (!attack) return;
        const entries = attack.expandEntries(context);
        this.enqueue(entries);
    }

    getTotalLines() {
        return this.entries.reduce((sum, entry) => (entry.type === 'line' ? sum + 1 : sum), 0);
    }

    isEmpty() {
        return this.entries.length === 0;
    }

    takePendingBlindEntries() {
        const blinds = [];
        while (this.entries.length > 0 && this.entries[0].type === 'blind') {
            blinds.push(this.entries.shift());
        }
        return blinds;
    }

    /**
     * Drain any leading blind / full_blind entries. Unlike takePendingBlindEntries
     * (which only matches 'blind'), this also takes 'full_blind' so a blind attack
     * at the head of the queue is consumed and no longer blocks the line burst
     * behind it. Returns the drained entries (each still carries its `duration`).
     */
    takePendingBlindBurst() {
        const blinds = [];
        while (
            this.entries.length > 0
            && (this.entries[0].type === 'blind' || this.entries[0].type === 'full_blind')
        ) {
            blinds.push(this.entries.shift());
        }
        return blinds;
    }

    dequeueLineBurst() {
        if (this.entries.length === 0) {
            return [];
        }
        if (this.entries[0].type !== 'line') {
            return [];
        }

        const burst = [];
        while (this.entries.length > 0 && this.entries[0].type === 'line') {
            const entry = this.entries.shift();
            burst.push(entry);
            if (entry.isLastInBurst) {
                break;
            }
        }
        return burst;
    }

    clear() {
        this.entries = [];
    }

    serialize() {
        return this.entries.map((entry) => cloneEntry(entry));
    }

    static fromSerialized(payload) {
        const queue = new GarbageQueue();
        if (Array.isArray(payload)) {
            payload.forEach((entry) => queue.enqueue(entry));
        }
        return queue;
    }
}
