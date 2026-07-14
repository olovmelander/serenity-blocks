// @ts-check
/**
 * Binary Snapshot Encoding - Phase 4
 *
 * Reduces snapshot size by ~90% compared to JSON encoding.
 * Critical for 8-player multiplayer bandwidth efficiency.
 *
 * Target: ≤4KB per 8-player snapshot @ 30Hz
 * Compared to JSON: ~12KB → ~1.2KB
 */

import { COLORS, SHAPES } from '../constants.js';

// Magic bytes for format identification
const BINARY_MAGIC = 0x5342_4E45; // "SBNE" - Serenity Blocks Network Encoding
const DELTA_MAGIC = 0x5342_4E44; // "SBND" - Serenity Blocks Network Delta
const FORMAT_VERSION = 7; // v7: per-garbage-ROW attacker color appended after the grid (placed garbage shows attacker color, not grey); v6: per-player awaitingSpawn byte (late-joiner ≠ eliminated); v5: per-garbage-entry attacker color (3-byte RGB); v4: sim/snapshot ids + ordered garbage provenance metadata

// Delta Change Flags (Bitmask)
const DELTA_FLAGS = {
    STATS: 1 << 0, // Score, lines, level, frags, alive
    GRID: 1 << 1, // Board grid
    PIECE: 1 << 2, // Current piece
    NEXT: 1 << 3, // Next pieces
    GARBAGE: 1 << 4, // Garbage queue
    DROPS: 1 << 5, // Drop counters
    BLIND: 1 << 6, // Blind timers state
};

// Cell types mapping (4 bits = 16 values)
const CELL_TYPES = ['empty', 'I', 'O', 'T', 'S', 'Z', 'J', 'L', 'garbage', 'clean_garbage', 'ghost'];
const CELL_TYPE_MAP = new Map(CELL_TYPES.map((type, i) => [type, i]));
CELL_TYPE_MAP.set('GARBAGE', CELL_TYPE_MAP.get('garbage'));
CELL_TYPE_MAP.set('CLEAN_GARBAGE', CELL_TYPE_MAP.get('clean_garbage'));

// Piece types mapping (3 bits = 8 values)
const PIECE_TYPES = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];
const PIECE_TYPE_MAP = new Map(PIECE_TYPES.map((type, i) => [type, i + 1])); // 0 = no piece

// Game phase mapping
/** @type {GamePhase[]} */
const GAME_PHASES = ['waiting', 'countdown', 'playing', 'finished'];
const GAME_PHASE_MAP = new Map(GAME_PHASES.map((phase, i) => [phase, i]));

// Grid dimensions
const GRID_COLS = 10;
const GRID_ROWS = 24; // Including hidden rows
const GRID_BYTES = GRID_COLS * GRID_ROWS / 2;
const MAX_BINARY_PLAYERS = 8;
const MAX_NEXT_PIECES = 32;
const MAX_GARBAGE_ENTRIES = 255;
const MAX_LOCKED_PIECES = GRID_ROWS * GRID_COLS;
const MAX_ACTIVE_SHAPE_ROWS = 4;
const MAX_ACTIVE_SHAPE_COLS = 4;
const GARBAGE_ENTRY_BYTES_V3 = 7;
const GARBAGE_ENTRY_FIXED_BYTES_V4 = 24;
const GARBAGE_ENTRY_FIXED_BYTES_V5 = 27; // v4 fixed bytes + 3-byte RGB attacker color

/** @param {unknown} value @returns {value is Record<string, any>} */
function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** @param {Record<string, any>} value @param {string} field */
function hasOptionalString(value, field) {
    return value[field] === undefined || typeof value[field] === 'string';
}

/** @param {Record<string, any>} value @param {string} field */
function hasOptionalFiniteNumber(value, field) {
    return value[field] === undefined || Number.isFinite(value[field]);
}

/** @param {unknown} value @param {number} maxRows @param {number} maxCols */
function isNumberShape(value, maxRows, maxCols) {
    return Array.isArray(value)
        && value.length > 0
        && value.length <= maxRows
        && value.every((row) => Array.isArray(row)
            && row.length > 0
            && row.length <= maxCols
            && row.every(Number.isFinite));
}

/** @param {unknown} value */
function isBoardCell(value) {
    if (value === null) return true;
    if (!isRecord(value) || typeof value.type !== 'string') return false;
    const idValid = value.id === undefined
        || typeof value.id === 'string'
        || Number.isFinite(value.id);
    return hasOptionalString(value, 'shapeKey')
        && hasOptionalString(value, 'color')
        && idValid;
}

/** @param {unknown} value */
function isBoardGrid(value) {
    return Array.isArray(value)
        && value.length === GRID_ROWS
        && value.every((row) => Array.isArray(row)
            && row.length === GRID_COLS
            && row.every(isBoardCell));
}

/** @param {unknown} value */
function isActivePiece(value) {
    if (value === null) return true;
    return isRecord(value)
        && typeof value.type === 'string'
        && Number.isFinite(value.x)
        && Number.isFinite(value.y)
        && Number.isFinite(value.rotation)
        && hasOptionalString(value, 'shapeKey')
        && hasOptionalString(value, 'color')
        && (value.shape === undefined
            || isNumberShape(value.shape, MAX_ACTIVE_SHAPE_ROWS, MAX_ACTIVE_SHAPE_COLS));
}

/** @param {unknown} value */
function isGarbageEntry(value) {
    if (!isRecord(value) || typeof value.type !== 'string') return false;
    const nullableStringFields = ['attackerId', 'attackerName'];
    const numericFields = [
        'attackSeq', 'lineIndex', 'duration', 'createdSimTick', 'sourceSimTick',
        'sourceLockSeq', 'applyAfterLockSeq', 'applySimTick',
    ];
    const attackIdValid = value.attackId === undefined
        || typeof value.attackId === 'string'
        || Number.isFinite(value.attackId);
    const holeMaskValid = value.holeMask === undefined
        || value.holeMask === null
        || (Number.isInteger(value.holeMask) && value.holeMask >= 0 && value.holeMask < (1 << GRID_COLS));
    const burstValid = value.isLastInBurst === undefined || typeof value.isLastInBurst === 'boolean';
    return nullableStringFields.every((field) => value[field] === undefined
            || value[field] === null
            || typeof value[field] === 'string')
        && ['color', 'variant', 'targetId', 'rulesHash'].every((field) => hasOptionalString(value, field))
        && numericFields.every((field) => hasOptionalFiniteNumber(value, field))
        && attackIdValid
        && holeMaskValid
        && burstValid;
}

/** @param {unknown} value */
function isLockedPiece(value) {
    if (!isRecord(value)) return false;
    const pieceIdValid = value.pieceId === undefined
        || typeof value.pieceId === 'string'
        || Number.isFinite(value.pieceId);
    return hasOptionalString(value, 'type')
        && hasOptionalString(value, 'shapeKey')
        && hasOptionalString(value, 'color')
        && isNumberShape(value.shape, GRID_ROWS, GRID_COLS)
        && Number.isFinite(value.x)
        && Number.isFinite(value.y)
        && pieceIdValid;
}

/** @param {unknown} value @returns {value is PackedPlayerSnapshotV7} */
function isPackedPlayerSnapshot(value) {
    if (!isRecord(value)) return false;
    const numericFields = [
        'score', 'lines', 'level', 'frags', 'garbagePending', 'dropCounter', 'dropInterval',
    ];
    const blindTimersValid = value.blindTimers === null
        || (isRecord(value.blindTimers)
            && ['field', 'fieldMax', 'pending', 'pendingMax']
                .every((field) => Number.isFinite(value.blindTimers[field])));
    return typeof value.steamId === 'string'
        && typeof value.name === 'string'
        && typeof value.color === 'string'
        && numericFields.every((field) => Number.isFinite(value[field]))
        && typeof value.isAlive === 'boolean'
        && typeof value.awaitingSpawn === 'boolean'
        && isBoardGrid(value.grid)
        && isActivePiece(value.currentPiece)
        && Array.isArray(value.nextPieces)
        && value.nextPieces.length <= MAX_NEXT_PIECES
        && value.nextPieces.every((piece) => typeof piece === 'string' && PIECE_TYPE_MAP.has(piece))
        && Array.isArray(value.garbageEntries)
        && value.garbageEntries.length <= MAX_GARBAGE_ENTRIES
        && value.garbageEntries.every(isGarbageEntry)
        && Array.isArray(value.lockedPieces)
        && value.lockedPieces.length <= MAX_LOCKED_PIECES
        && value.lockedPieces.every(isLockedPiece)
        && blindTimersValid;
}

/** @param {PackedPlayerSnapshotV7} player @returns {PackedPlayerSnapshotV7} */
function copyPackedPlayerSnapshot(player) {
    return {
        steamId: player.steamId,
        name: player.name,
        color: player.color,
        score: player.score,
        lines: player.lines,
        level: player.level,
        frags: player.frags,
        isAlive: player.isAlive,
        awaitingSpawn: player.awaitingSpawn,
        garbagePending: player.garbagePending,
        grid: player.grid,
        currentPiece: player.currentPiece,
        nextPieces: player.nextPieces,
        dropCounter: player.dropCounter,
        dropInterval: player.dropInterval,
        garbageEntries: player.garbageEntries,
        lockedPieces: player.lockedPieces,
        blindTimers: player.blindTimers,
    };
}

/**
 * Binary Encoder for game state snapshots
 */
export class BinaryEncoder {
    constructor() {
        this.debugMode = typeof window !== 'undefined'
            && window.__DEBUG_JSON_SNAPSHOTS__ === true;

        // Reusable buffers for encoding
        this._gridBuffer = new ArrayBuffer(GRID_COLS * GRID_ROWS / 2); // 120 bytes
        this._gridView = new Uint8Array(this._gridBuffer);
    }

    /**
     * Encode a full game state snapshot to binary
     * @param {BinaryStateSnapshotV7} snapshot - The snapshot from buildStateSnapshot()
     * @returns {ArrayBuffer} Binary encoded snapshot
     */
    encodeSnapshot(snapshot) {
        if (this.debugMode) {
            // Debug mode: return JSON for readable output
            return this._encodeAsJson(snapshot);
        }

        const players = snapshot.players || [];
        const playerCount = players.length;

        // Calculate required buffer size
        // Header: 20 bytes (magic + version + playerCount + gamePhase + tick + sim/snapshot ids)
        // Per player: allow heavy garbage queues with v4 provenance metadata.
        const estimatedSize = 64 + (playerCount * 8192);
        const buffer = new ArrayBuffer(estimatedSize);
        const view = new DataView(buffer);
        let offset = 0;

        // === HEADER (12 bytes) ===
        view.setUint32(offset, BINARY_MAGIC, false); offset += 4; // Big-endian magic
        view.setUint8(offset++, FORMAT_VERSION);
        view.setUint8(offset++, playerCount);
        view.setUint8(offset++, GAME_PHASE_MAP.get(snapshot.gamePhase) || 0);
        view.setUint8(offset++, 0); // Reserved byte for alignment
        view.setUint32(offset, snapshot.tick || 0, true); offset += 4; // Little-endian tick
        view.setUint32(offset, snapshot.simTick || snapshot.tick || 0, true); offset += 4;
        view.setUint32(offset, snapshot.snapshotSeq || snapshot.tick || 0, true); offset += 4;

        // === PLAYER DATA ===
        for (const player of players) {
            offset = this._encodePlayer(buffer, view, offset, player);
        }

        // === WINNER (if any) ===
        if (snapshot.winner) {
            view.setUint8(offset++, 1); // Has winner
            offset = this._writeString(buffer, view, offset, snapshot.winner.steamId || '');
            offset = this._writeString(buffer, view, offset, snapshot.winner.name || '');
        } else {
            view.setUint8(offset++, 0); // No winner
        }

        // Return trimmed buffer
        return buffer.slice(0, offset);
    }

    /**
     * Encode a delta snapshot relative to a baseline
     * Returns NULL if delta is not possible (e.g. player list changed)
     * @param {BinaryStateSnapshotV7} current
     * @param {BinaryStateSnapshotV7} baseline
     * @returns {ArrayBuffer|null}
     */
    encodeDeltaSnapshot(current, baseline) {
        if (!baseline || !current) return null;

        // 1. Validation: Player list must be identical for index-based delta
        if (current.players.length !== baseline.players.length) return null;

        // Sort both to ensure order matches (deterministic)
        // Note: Assuming input arrays are already sorted or consistently ordered by steamId
        // We do a quick check of SteamIDs to verify match
        for (let i = 0; i < current.players.length; i++) {
            if (current.players[i].steamId !== baseline.players[i].steamId) {
                return null; // Player mismatch, force full snapshot
            }
        }

        const playerCount = current.players.length;
        const estimatedSize = 64 + (playerCount * 8192); // Same buffer safety
        const buffer = new ArrayBuffer(estimatedSize);
        const view = new DataView(buffer);
        let offset = 0;

        // === HEADER (16 bytes) ===
        view.setUint32(offset, DELTA_MAGIC, false); offset += 4;
        view.setUint8(offset++, FORMAT_VERSION);
        view.setUint8(offset++, playerCount);
        view.setUint8(offset++, GAME_PHASE_MAP.get(current.gamePhase) || 0);
        view.setUint8(offset++, 0); // Reserved
        view.setUint32(offset, current.tick || 0, true); offset += 4;
        view.setUint32(offset, current.simTick || current.tick || 0, true); offset += 4;
        view.setUint32(offset, current.snapshotSeq || current.tick || 0, true); offset += 4;
        view.setUint32(offset, baseline.tick || 0, true); offset += 4; // Baseline tick ref

        // === PLAYER DELTAS ===
        for (let i = 0; i < playerCount; i++) {
            offset = this._encodePlayerDelta(buffer, view, offset, current.players[i], baseline.players[i]);
        }

        // === WINNER (if changed) ===
        // Simple strategy: Always write winner if present, as it's rare/final
        if (current.winner) {
            view.setUint8(offset++, 1);
            offset = this._writeString(buffer, view, offset, current.winner.steamId || '');
            offset = this._writeString(buffer, view, offset, current.winner.name || '');
        } else {
            view.setUint8(offset++, 0);
        }

        return buffer.slice(0, offset);
    }

    /**
     * Encode a single player's delta.
     * @param {ArrayBuffer} buffer
     * @param {DataView} view
     * @param {number} offset
     * @param {PackedPlayerSnapshotV7} current
     * @param {PackedPlayerSnapshotV7} baseline
     * @returns {number}
     */
    _encodePlayerDelta(buffer, view, offset, current, baseline) {
        // Calculate Change Mask
        let mask = 0;

        // Stats check
        if (current.score !== baseline.score
            || current.lines !== baseline.lines
            || current.level !== baseline.level
            || current.frags !== baseline.frags
            || current.isAlive !== baseline.isAlive
            || (current.awaitingSpawn === true) !== (baseline.awaitingSpawn === true)
            || current.garbagePending !== baseline.garbagePending) {
            mask |= DELTA_FLAGS.STATS;
        }

        // Drop state check
        if (current.dropCounter !== baseline.dropCounter
            || current.dropInterval !== baseline.dropInterval) {
            mask |= DELTA_FLAGS.DROPS;
        }

        // Piece check (simple prop check)
        // We use JSON stringify for deep object check if needed, or prop-by-prop
        // Prop-by-prop is faster
        if (this._pieceChanged(current.currentPiece, baseline.currentPiece)) {
            mask |= DELTA_FLAGS.PIECE;
        }

        // Next pieces check
        // Check lengths first, then types
        if (this._nextPiecesChanged(current.nextPieces, baseline.nextPieces)) {
            mask |= DELTA_FLAGS.NEXT;
        }

        // Garbage check
        // Check counts primarily, usually sufficient for sync
        if (current.garbageEntries?.length !== baseline.garbageEntries?.length) {
            mask |= DELTA_FLAGS.GARBAGE;
        } else if (current.garbageEntries?.length > 0) {
            // Deep check needed if lengths same
            if (JSON.stringify(current.garbageEntries) !== JSON.stringify(baseline.garbageEntries)) {
                mask |= DELTA_FLAGS.GARBAGE;
            }
        }

        // Grid check
        // This is the expensive one. We only check if grid ref changed?
        // No, in JS refs are constant often. Need content check.
        // Optimization: host usually knows if grid is dirty.
        // But here we are purely data-driven.
        // Let's assume if Stats.lines changed, grid changed.
        // What about moving pieces locking?
        // We simply compare the 120 bytes?
        // Actually, we can just *always* send grid if Piece Changed? No.
        // Let's do a fast cell comparison.
        if (this._gridChanged(current.grid, baseline.grid)) {
            mask |= DELTA_FLAGS.GRID;
        }

        // Blind check
        if (current.blindTimers?.field !== baseline.blindTimers?.field
            || current.blindTimers?.fieldMax !== baseline.blindTimers?.fieldMax
            || current.blindTimers?.pending !== baseline.blindTimers?.pending
            || current.blindTimers?.pendingMax !== baseline.blindTimers?.pendingMax) {
            mask |= DELTA_FLAGS.BLIND;
        }

        // Write Mask
        view.setUint8(offset++, mask);

        // Write Changed Fields
        if (mask & DELTA_FLAGS.STATS) {
            view.setUint32(offset, current.score || 0, true); offset += 4;
            view.setUint16(offset, current.lines || 0, true); offset += 2;
            view.setUint8(offset++, current.level || 1);
            view.setUint16(offset, current.frags || 0, true); offset += 2;
            view.setUint8(offset++, current.isAlive ? 1 : 0);
            view.setUint8(offset++, Math.min(current.garbagePending || 0, 255));
            // v6: awaitingSpawn (late joiner ≠ eliminated)
            view.setUint8(offset++, current.awaitingSpawn ? 1 : 0);
        }

        if (mask & DELTA_FLAGS.DROPS) {
            view.setUint16(offset, Math.min(current.dropCounter || 0, 65535), true); offset += 2;
            view.setUint16(offset, Math.min(current.dropInterval || 1000, 65535), true); offset += 2;
        }

        if (mask & DELTA_FLAGS.GRID) {
            offset = this._encodeGrid(buffer, view, offset, current.grid);
            // v7: garbage row colors ride with the grid (they change together).
            offset = this._encodeGarbageRowColors(buffer, view, offset, current.grid);
        }

        if (mask & DELTA_FLAGS.PIECE) {
            offset = this._encodePiece(buffer, view, offset, current.currentPiece);
        }

        if (mask & DELTA_FLAGS.NEXT) {
            const nextPieces = current.nextPieces || [];
            view.setUint8(offset++, nextPieces.length);
            for (const piece of nextPieces) {
                const typeIndex = PIECE_TYPE_MAP.get(piece) || 0;
                view.setUint8(offset++, typeIndex);
            }
        }

        if (mask & DELTA_FLAGS.GARBAGE) {
            const garbageEntries = current.garbageEntries || [];
            view.setUint8(offset++, Math.min(garbageEntries.length, 255));
            for (let i = 0; i < Math.min(garbageEntries.length, 255); i++) {
                offset = this._encodeGarbageEntry(buffer, view, offset, garbageEntries[i]);
            }
        }

        if (mask & DELTA_FLAGS.BLIND) {
            offset = this._encodeBlindTimers(view, offset, current.blindTimers);
        }

        return offset;
    }

    _pieceChanged(p1, p2) {
        if (p1 === p2) return false;
        if (!p1 || !p2) return true; // One is null
        return p1.x !== p2.x || p1.y !== p2.y || p1.rotation !== p2.rotation || p1.type !== p2.type;
    }

    _nextPiecesChanged(n1, n2) {
        if (n1 === n2) return false;
        if (!n1 || !n2) return true;
        if (n1.length !== n2.length) return true;
        for (let i = 0; i < n1.length; i++) {
            const t1 = n1[i]?.type || n1[i];
            const t2 = n2[i]?.type || n2[i];
            if (t1 !== t2) return true;
        }
        return false;
    }

    _gridChanged(g1, g2) {
        if (g1 === g2) return false;
        if (!g1 || !g2) return true;
        // Sample a few rows? No, safety first.
        // Grid is 10x24. Iterate cells.
        for (let y = 0; y < GRID_ROWS; y++) {
            const r1 = g1[y];
            const r2 = g2[y];
            if (!r1 || !r2) return true;
            for (let x = 0; x < GRID_COLS; x++) {
                const c1 = r1[x]?.type || 'empty';
                const c2 = r2[x]?.type || 'empty';
                if (c1 !== c2) return true;
            }
        }
        return false;
    }

    /**
     * Encode a single player's state.
     * @param {ArrayBuffer} buffer
     * @param {DataView} view
     * @param {number} offset
     * @param {PackedPlayerSnapshotV7} player
     * @returns {number}
     */
    _encodePlayer(buffer, view, offset, player) {
        // Ensure buffer is large enough
        if (offset + 300 > buffer.byteLength) {
            throw new Error('Buffer overflow in player encoding');
        }

        // === PLAYER IDENTITY (variable length) ===
        offset = this._writeString(buffer, view, offset, player.steamId || '');
        offset = this._writeString(buffer, view, offset, player.name || '');
        offset = this._writeString(buffer, view, offset, player.color || '#ffffff');

        // === STATS (12 bytes) ===
        view.setUint32(offset, player.score || 0, true); offset += 4;
        view.setUint16(offset, player.lines || 0, true); offset += 2;
        view.setUint8(offset++, player.level || 1);
        view.setUint16(offset, player.frags || 0, true); offset += 2;
        view.setUint8(offset++, player.isAlive ? 1 : 0);
        view.setUint8(offset++, Math.min(player.garbagePending || 0, 255));
        // v6: late joiner WAITING to spawn (isAlive:false but NOT eliminated). Stripping this
        // is what made late joiners render as ELIMINATED+skull on opponents' mini-boards.
        view.setUint8(offset++, player.awaitingSpawn ? 1 : 0);

        // === DROP STATE (4 bytes) ===
        view.setUint16(offset, Math.min(player.dropCounter || 0, 65535), true); offset += 2;
        view.setUint16(offset, Math.min(player.dropInterval || 1000, 65535), true); offset += 2;

        // === GRID (120 bytes - 2 cells per byte) ===
        offset = this._encodeGrid(buffer, view, offset, player.grid);

        // === GARBAGE ROW COLORS (v7+, variable: 1 + count*4 bytes) ===
        offset = this._encodeGarbageRowColors(buffer, view, offset, player.grid);

        // === CURRENT PIECE (5 bytes) ===
        offset = this._encodePiece(buffer, view, offset, player.currentPiece);

        // === NEXT PIECES (variable, typically 5-7 pieces) ===
        const nextPieces = player.nextPieces || [];
        view.setUint8(offset++, nextPieces.length);
        for (const piece of nextPieces) {
            const typeIndex = PIECE_TYPE_MAP.get(piece) || 0;
            view.setUint8(offset++, typeIndex);
        }

        // === GARBAGE ENTRIES (variable length) ===
        const garbageEntries = player.garbageEntries || [];
        view.setUint8(offset++, Math.min(garbageEntries.length, 255));
        for (let i = 0; i < Math.min(garbageEntries.length, 255); i++) {
            offset = this._encodeGarbageEntry(buffer, view, offset, garbageEntries[i]);
        }

        // === LOCKED PIECES (variable length) - Skip for bandwidth optimization ===
        // Locked pieces can be reconstructed from grid, so we skip them
        // to save ~200+ bytes per player
        view.setUint8(offset++, 0); // lockedPieces count = 0

        // === BLIND TIMERS (8 bytes) ===
        offset = this._encodeBlindTimers(view, offset, player.blindTimers);

        return offset;
    }

    /**
     * Encode the game grid (10x24 = 240 cells → 120 bytes)
     * Uses 4 bits per cell (2 cells per byte)
     */
    _encodeGrid(buffer, view, offset, grid) {
        if (!grid || !Array.isArray(grid)) {
            // Empty grid - fill with zeros
            for (let i = 0; i < 120; i++) {
                view.setUint8(offset + i, 0);
            }
            return offset + 120;
        }

        let byteIndex = 0;
        for (let y = 0; y < GRID_ROWS; y++) {
            const row = grid[y] || [];
            for (let x = 0; x < GRID_COLS; x += 2) {
                const cell1 = this._getCellType(row[x]);
                const cell2 = this._getCellType(row[x + 1]);
                view.setUint8(offset + byteIndex, (cell1 << 4) | cell2);
                byteIndex++;
            }
        }

        return offset + 120;
    }

    /**
     * v7: encode the per-garbage-ROW attacker color appended after the grid. The 4-bit packed
     * grid carries cell TYPE only, so a garbage row's attacker color (set on its cells by
     * insertGarbageEntries) is otherwise lost on the wire — opponent mini-boards then render
     * placed garbage as generic grey instead of the attacker's color. Every cell in a garbage
     * row shares one color, so we emit one (rowIndex, RGB) per row whose color isn't the default
     * grey. Format: 1 byte count, then count * (1 byte rowIndex + 3 bytes RGB).
     */
    _encodeGarbageRowColors(buffer, view, offset, grid) {
        const rows = [];
        if (grid && Array.isArray(grid)) {
            for (let y = 0; y < GRID_ROWS; y++) {
                const row = grid[y];
                if (!row) continue;
                for (let x = 0; x < GRID_COLS; x++) {
                    const cell = row[x];
                    if (!cell || typeof cell !== 'object') continue;
                    const t = cell.type || cell.shapeKey;
                    if (t === 'GARBAGE' || t === 'CLEAN_GARBAGE') {
                        // First garbage cell in the row carries the row's color.
                        if (cell.color && cell.color !== '#808080') {
                            rows.push({ rowIndex: y, color: cell.color });
                        }
                        break;
                    }
                }
            }
        }
        const count = Math.min(rows.length, 255);
        view.setUint8(offset++, count);
        for (let i = 0; i < count; i++) {
            view.setUint8(offset++, rows[i].rowIndex);
            offset = this._writeColorRGB(view, offset, rows[i].color);
        }
        return offset;
    }

    /**
     * Get cell type index (0-15)
     */
    _getCellType(cell) {
        if (!cell) return 0; // empty
        const rawType = cell.type || cell.shapeKey || cell.color || 'empty';
        const type = typeof rawType === 'string' ? rawType : 'empty';
        return CELL_TYPE_MAP.get(type) || CELL_TYPE_MAP.get(type.toLowerCase()) || 0;
    }

    /**
     * Encode a piece (5 bytes)
     */
    _encodePiece(buffer, view, offset, piece) {
        if (!piece) {
            // No current piece
            view.setUint8(offset++, 0); // type = 0 (no piece)
            view.setUint8(offset++, 0); // x
            view.setUint8(offset++, 0); // y
            view.setUint8(offset++, 0); // rotation
            view.setUint8(offset++, 0); // reserved
            return offset;
        }

        const typeIndex = PIECE_TYPE_MAP.get(piece.type) || 0;
        view.setUint8(offset++, typeIndex);
        view.setUint8(offset++, piece.x !== undefined ? piece.x + 128 : 128); // Offset for negative values
        view.setUint8(offset++, piece.y !== undefined ? piece.y + 128 : 128);
        view.setUint8(offset++, piece.rotation || 0);
        view.setUint8(offset++, 0); // Reserved

        return offset;
    }

    _encodeBlindTimers(view, offset, blindTimers) {
        const bt = blindTimers || {};
        const fieldCentis = Math.min(65535, Math.round((bt.field || 0) * 100));
        const fieldMaxCentis = Math.min(65535, Math.round((bt.fieldMax || 0) * 100));
        const pendingCentis = Math.min(65535, Math.round((bt.pending || 0) * 100));
        const pendingMaxCentis = Math.min(65535, Math.round((bt.pendingMax || 0) * 100));

        view.setUint16(offset, fieldCentis, true); offset += 2;
        view.setUint16(offset, fieldMaxCentis, true); offset += 2;
        view.setUint16(offset, pendingCentis, true); offset += 2;
        view.setUint16(offset, pendingMaxCentis, true); offset += 2;

        return offset;
    }

    _clampUint(value, max = 0xFFFFFFFF) {
        const n = Number(value);
        if (!Number.isFinite(n) || n <= 0) return 0;
        return Math.min(max, Math.floor(n));
    }

    _attackSeqFromEntry(entry = {}) {
        if (entry.attackSeq != null) return this._clampUint(entry.attackSeq);
        if (typeof entry.attackId === 'number') return this._clampUint(entry.attackId);
        if (typeof entry.attackId === 'string') {
            const match = entry.attackId.match(/(\d+)(?!.*\d)/);
            if (match) return this._clampUint(match[1]);
        }
        return 0;
    }

    /**
     * Encode a garbage entry (v4: 24 bytes, v3 legacy: 7 bytes).
     * @param {ArrayBuffer} buffer
     * @param {DataView} view
     * @param {number} offset
     * @param {GarbageEntrySnapshot|null|undefined} entry
     * @returns {number}
     */
    _encodeGarbageEntry(buffer, view, offset, entry) {
        if (!entry) {
            for (let i = 0; i < GARBAGE_ENTRY_FIXED_BYTES_V5; i++) view.setUint8(offset + i, 0);
            return this._writeString(buffer, view, offset + GARBAGE_ENTRY_FIXED_BYTES_V5, '');
        }

        // Type byte packs flags into its spare bits (the board is 10 columns, so the
        // hole mask needs 10 bits — the low 8 go in their own byte below, the high 2
        // ride here; previously they were truncated, garbling garbage on peer
        // victims). Bits: [0-1]=type, [2-3]=holeMask>>8, [4]=variant 'clean', [5]=isLastInBurst.
        let typeVal = 3; // 0 = line, 1 = blind, 2 = full_blind, 3 = other
        if (entry.type === 'line') typeVal = 0;
        else if (entry.type === 'blind') typeVal = 1;
        else if (entry.type === 'full_blind') typeVal = 2;
        const holeMask = entry.holeMask || 0;
        const holeHi = (holeMask >> 8) & 0x03;
        const variantBit = entry.variant === 'clean' ? 1 : 0;
        const lastBit = entry.isLastInBurst ? 1 : 0;
        view.setUint8(offset++, (typeVal & 0x03) | (holeHi << 2) | (variantBit << 4) | (lastBit << 5));

        // Attacker ID hash (4 bytes) - Use simple hash for compact encoding
        const attackerHash = this._hashString(entry.attackerId || '');
        view.setUint32(offset, attackerHash, true); offset += 4;

        // Hole mask low 8 bits (the high 2 are in the type byte above).
        view.setUint8(offset++, holeMask & 0xFF);

        // Duration (1 byte) - encoded in deciseconds (Math.round(entry.duration * 10))
        const durationVal = Math.min(255, Math.round((entry.duration || 0) * 10));
        view.setUint8(offset++, durationVal);

        view.setUint32(offset, this._attackSeqFromEntry(entry), true); offset += 4;
        view.setUint8(offset++, this._clampUint(entry.lineIndex, 255));
        view.setUint32(offset, this._clampUint(entry.createdSimTick), true); offset += 4;
        view.setUint32(offset, this._clampUint(entry.sourceSimTick), true); offset += 4;
        view.setUint16(offset, this._clampUint(entry.sourceLockSeq, 65535), true); offset += 2;
        view.setUint16(offset, this._clampUint(entry.applyAfterLockSeq, 65535), true); offset += 2;

        // v5: attacker color as 3-byte RGB so each victim's garbage rows render in the
        // sender's player color (matching local MP) instead of a uniform grey. #000000
        // encodes "no color" and decodes back to undefined (renderer falls back to grey).
        offset = this._writeColorRGB(view, offset, entry.color);

        offset = this._writeString(buffer, view, offset, entry.attackId || '');

        return offset;
    }

    /**
     * Write a hex color string ('#rrggbb') as 3 RGB bytes. Non-hex / missing → 0,0,0.
     */
    _writeColorRGB(view, offset, color) {
        let r = 0;
        let g = 0;
        let b = 0;
        if (typeof color === 'string' && color.charCodeAt(0) === 35 /* '#' */ && color.length >= 7) {
            const rr = parseInt(color.slice(1, 3), 16);
            const gg = parseInt(color.slice(3, 5), 16);
            const bb = parseInt(color.slice(5, 7), 16);
            if (!Number.isNaN(rr)) r = rr & 0xFF;
            if (!Number.isNaN(gg)) g = gg & 0xFF;
            if (!Number.isNaN(bb)) b = bb & 0xFF;
        }
        view.setUint8(offset, r);
        view.setUint8(offset + 1, g);
        view.setUint8(offset + 2, b);
        return offset + 3;
    }

    /**
     * Write a length-prefixed string
     */
    _writeString(buffer, view, offset, str) {
        const bytes = new TextEncoder().encode(str || '');
        const len = Math.min(bytes.length, 255);
        view.setUint8(offset++, len);

        const target = new Uint8Array(buffer, offset, len);
        target.set(bytes.slice(0, len));

        return offset + len;
    }

    /**
     * Simple string hash for compact attacker ID encoding
     */
    _hashString(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash &= hash; // Convert to 32-bit integer
        }
        return hash >>> 0; // Ensure unsigned
    }

    /**
     * Debug mode: encode as JSON (for development)
     */
    _encodeAsJson(snapshot) {
        const json = JSON.stringify(snapshot);
        return new TextEncoder().encode(json).buffer;
    }
}

/**
 * Binary Decoder for game state snapshots
 */
export class BinaryDecoder {
    constructor() {
        this.debugMode = typeof window !== 'undefined'
            && window.__DEBUG_JSON_SNAPSHOTS__ === true;

        // Cache for attacker ID reverse lookup
        this._attackerIdCache = new Map();
    }

    _assertAvailable(view, offset, byteCount, label) {
        if (!Number.isInteger(offset) || offset < 0 || offset + byteCount > view.byteLength) {
            throw new RangeError(`Malformed binary snapshot: ${label} exceeds packet bounds`);
        }
    }

    _readUint8(view, offset, label) {
        this._assertAvailable(view, offset, 1, label);
        return view.getUint8(offset);
    }

    /**
     * Register known attacker IDs for reverse lookup
     */
    registerAttackerIds(playerMap) {
        this._attackerIdCache.clear();
        for (const [steamId] of playerMap) {
            const hash = this._hashString(steamId);
            this._attackerIdCache.set(hash, steamId);
        }
    }

    /**
     * Decode a binary snapshot back to object form
     * @param {ArrayBuffer} buffer - Binary encoded snapshot
     * @returns {BinaryStateSnapshotV7|null} Decoded packed body
     */
    decodeSnapshot(buffer) {
        if (this.debugMode) {
            // Debug mode: decode JSON
            return this._decodeFromJson(buffer);
        }

        const view = new DataView(buffer);
        this._assertAvailable(view, 0, 12, 'snapshot header');
        let offset = 0;

        // === HEADER ===
        const magic = view.getUint32(offset, false); offset += 4;
        if (magic === DELTA_MAGIC) {
            throw new Error('Use decodeDeltaSnapshot for delta packets');
        }
        if (magic !== BINARY_MAGIC) {
            // Not binary format, try JSON fallback
            return this._decodeFromJson(buffer);
        }

        const version = view.getUint8(offset++);
        if (version !== FORMAT_VERSION) {
            throw new Error(`Binary format version mismatch: expected ${FORMAT_VERSION}, got ${version}`);
        }

        const playerCount = view.getUint8(offset++);
        if (playerCount > MAX_BINARY_PLAYERS) {
            throw new Error(`Malformed binary snapshot: player count ${playerCount} exceeds ${MAX_BINARY_PLAYERS}`);
        }
        const gamePhaseIndex = view.getUint8(offset++);
        offset++; // Reserved byte
        const tick = view.getUint32(offset, true); offset += 4;
        let simTick = tick;
        let snapshotSeq = tick;
        if (version >= 4) {
            this._assertAvailable(view, offset, 8, 'snapshot v4 header');
            simTick = view.getUint32(offset, true); offset += 4;
            snapshotSeq = view.getUint32(offset, true); offset += 4;
        }

        const gamePhase = GAME_PHASES[gamePhaseIndex] || 'waiting';

        // === PLAYER DATA ===
        const players = [];
        for (let i = 0; i < playerCount; i++) {
            const result = this._decodePlayer(buffer, view, offset, version);
            players.push(result.player);
            offset = result.offset;
        }

        // === WINNER ===
        const hasWinner = this._readUint8(view, offset++, 'winner flag');
        let winner = null;
        if (hasWinner) {
            const winnerSteamId = this._readString(buffer, view, offset);
            offset = winnerSteamId.offset;
            const winnerName = this._readString(buffer, view, offset);
            offset = winnerName.offset;
            winner = { steamId: winnerSteamId.value, name: winnerName.value };
        }

        if (offset !== view.byteLength) {
            throw new Error(
                `Malformed binary snapshot: ${view.byteLength - offset} trailing bytes`,
            );
        }

        return {
            players,
            gamePhase,
            winner,
            timestamp: Date.now(),
            tick,
            simTick,
            snapshotSeq,
        };
    }

    /**
     * Cheaply read the baseline tick a delta packet was encoded against, WITHOUT
     * decoding the whole delta. Lets the receiver classify a delta as current /
     * superseded-straggler / ahead-of-baseline before committing to a full decode
     * (and before throwing a noisy mismatch error). Returns null if not a delta.
     *
     * Header layout (see decodeDeltaSnapshot): magic[4] version[1] playerCount[1]
     * gamePhase[1] reserved[1] tick[4] baselineTick[4] → baselineTick at byte 12.
     */
    peekDeltaBaselineTick(buffer) {
        const view = new DataView(buffer);
        if (view.byteLength < 16) return null;
        if (view.getUint32(0, false) !== DELTA_MAGIC) return null;
        const version = view.getUint8(4);
        const baselineOffset = version >= 4 ? 20 : 12;
        if (view.byteLength < baselineOffset + 4) return null;
        return view.getUint32(baselineOffset, true);
    }

    /**
     * Decode a delta snapshot using a baseline state
     * @param {ArrayBuffer} buffer
     * @param {BinaryStateSnapshotV7} baseline
     * @returns {BinaryStateSnapshotV7|null}
     */
    decodeDeltaSnapshot(buffer, baseline) {
        if (!baseline) throw new Error('Baseline required for delta decode');

        const view = new DataView(buffer);
        this._assertAvailable(view, 0, 16, 'delta header');
        let offset = 0;

        // === HEADER ===
        const magic = view.getUint32(offset, false); offset += 4;
        if (magic !== DELTA_MAGIC) {
            // Fallback if full snapshot passed by mistake
            if (magic === BINARY_MAGIC) return this.decodeSnapshot(buffer);
            return this._decodeFromJson(buffer);
        }

        const version = view.getUint8(offset++);
        if (version !== FORMAT_VERSION) {
            throw new Error(`Binary delta format version mismatch: expected ${FORMAT_VERSION}, got ${version}`);
        }
        const playerCount = view.getUint8(offset++);
        if (playerCount > MAX_BINARY_PLAYERS) {
            throw new Error(`Malformed binary delta: player count ${playerCount} exceeds ${MAX_BINARY_PLAYERS}`);
        }
        const gamePhaseIndex = view.getUint8(offset++);
        offset++; // Reserved
        const tick = view.getUint32(offset, true); offset += 4;
        let simTick = tick;
        let snapshotSeq = tick;
        if (version >= 4) {
            this._assertAvailable(view, offset, 8, 'delta v4 header');
            simTick = view.getUint32(offset, true); offset += 4;
            snapshotSeq = view.getUint32(offset, true); offset += 4;
        }
        const baselineTick = view.getUint32(offset, true); offset += 4;

        if (baseline.tick && baseline.tick !== baselineTick) {
            throw new Error(`Delta baseline mismatch: expected ${baselineTick}, have ${baseline.tick}`);
        }

        const gamePhase = GAME_PHASES[gamePhaseIndex] || 'waiting';
        const players = [];

        // === PLAYER DELTAS ===
        // NOTE: Delta assumes player count/order matches baseline.
        // If baseline has different player count, we might crash or desync.
        // But encodeDelta guarantees structure match.
        // We must reuse baseline players for Identity fields (Name, SteamID, Color).

        for (let i = 0; i < playerCount; i++) {
            // Get baseline player
            const basePlayer = baseline.players[i];
            if (!basePlayer) {
                throw new Error(`Baseline missing player at index ${i}`);
            }

            const result = this._decodePlayerDelta(buffer, view, offset, basePlayer, version);
            players.push(result.player);
            offset = result.offset;
        }

        // === WINNER ===
        const hasWinner = this._readUint8(view, offset++, 'delta winner flag');
        let winner = null;
        if (hasWinner) {
            const winnerSteamId = this._readString(buffer, view, offset);
            offset = winnerSteamId.offset;
            const winnerName = this._readString(buffer, view, offset);
            offset = winnerName.offset;
            winner = { steamId: winnerSteamId.value, name: winnerName.value };
        } else {
            // Provide baseline winner if not explicitly cleared?
            // No, encoder writes winner explicitly if present.
            // If encoder writes 0, it means no winner.
            // So we default to null.
            winner = null;
        }

        if (offset !== view.byteLength) {
            throw new Error(
                `Malformed binary delta: ${view.byteLength - offset} trailing bytes`,
            );
        }

        return {
            players,
            gamePhase,
            winner,
            timestamp: Date.now(),
            tick,
            simTick,
            snapshotSeq,
        };
    }

    /**
     * @param {ArrayBuffer} buffer
     * @param {DataView} view
     * @param {number} offset
     * @param {PackedPlayerSnapshotV7} basePlayer
     * @param {number} [version]
     * @returns {{player: PackedPlayerSnapshotV7, offset: number}}
     */
    _decodePlayerDelta(buffer, view, offset, basePlayer, version = FORMAT_VERSION) {
        const mask = this._readUint8(view, offset++, 'player delta mask');
        const p = copyPackedPlayerSnapshot(basePlayer);

        // Stats
        if (mask & DELTA_FLAGS.STATS) {
            this._assertAvailable(view, offset, version >= 6 ? 12 : 11, 'player delta stats');
            p.score = view.getUint32(offset, true); offset += 4;
            p.lines = view.getUint16(offset, true); offset += 2;
            p.level = view.getUint8(offset++);
            p.frags = view.getUint16(offset, true); offset += 2;
            p.isAlive = view.getUint8(offset++) === 1;
            p.garbagePending = view.getUint8(offset++);
            // v6: awaitingSpawn (late joiner ≠ eliminated). Older streams leave the baseline value.
            if (version >= 6) {
                p.awaitingSpawn = view.getUint8(offset++) === 1;
            }
        }

        // Drops
        if (mask & DELTA_FLAGS.DROPS) {
            this._assertAvailable(view, offset, 4, 'player delta drops');
            p.dropCounter = view.getUint16(offset, true); offset += 2;
            p.dropInterval = view.getUint16(offset, true); offset += 2;
        }

        // Grid
        if (mask & DELTA_FLAGS.GRID) {
            p.grid = this._decodeGrid(buffer, view, offset);
            offset += GRID_BYTES;
            // v7: paint per-garbage-row attacker colors before rebuilding locked pieces so both
            // the grid (rendered) and lockedPieces carry the attacker color.
            if (version >= 7) {
                offset = this._applyGarbageRowColors(view, offset, p.grid);
            }
            p.lockedPieces = this._reconstructLockedPiecesFromGrid(p.grid);
        }

        // Piece
        if (mask & DELTA_FLAGS.PIECE) {
            p.currentPiece = this._decodePiece(buffer, view, offset);
            offset += 5;
        }

        // Next Pieces
        if (mask & DELTA_FLAGS.NEXT) {
            const nextPieceCount = this._readUint8(view, offset++, 'player delta next-piece count');
            if (nextPieceCount > MAX_NEXT_PIECES) {
                throw new Error(`Malformed binary delta: next-piece count ${nextPieceCount} exceeds ${MAX_NEXT_PIECES}`);
            }
            this._assertAvailable(view, offset, nextPieceCount, 'player delta next pieces');
            const nextPieces = [];
            for (let i = 0; i < nextPieceCount; i++) {
                const typeIndex = view.getUint8(offset++);
                if (typeIndex > 0 && typeIndex <= PIECE_TYPES.length) {
                    nextPieces.push(PIECE_TYPES[typeIndex - 1]);
                }
            }
            p.nextPieces = nextPieces;
        }

        // Garbage
        if (mask & DELTA_FLAGS.GARBAGE) {
            const garbageCount = this._readUint8(view, offset++, 'player delta garbage count');
            const garbageEntries = [];
            for (let i = 0; i < garbageCount; i++) {
                const result = this._decodeGarbageEntry(buffer, view, offset, version);
                garbageEntries.push(result.entry);
                offset = result.offset;
            }
            p.garbageEntries = garbageEntries;
        }

        // Blind
        if (mask & DELTA_FLAGS.BLIND) {
            const result = this._decodeBlindTimers(view, offset);
            p.blindTimers = result.timers;
            offset = result.offset;
        }

        return { player: p, offset };
    }

    /**
     * Decode a single player's state.
     * @param {ArrayBuffer} buffer
     * @param {DataView} view
     * @param {number} offset
     * @param {number} [version]
     * @returns {{player: PackedPlayerSnapshotV7, offset: number}}
     */
    _decodePlayer(buffer, view, offset, version = FORMAT_VERSION) {
        // === IDENTITY ===
        const steamId = this._readString(buffer, view, offset);
        offset = steamId.offset;
        const name = this._readString(buffer, view, offset);
        offset = name.offset;
        const color = this._readString(buffer, view, offset);
        offset = color.offset;

        // === STATS ===
        this._assertAvailable(view, offset, version >= 6 ? 12 : 11, 'player stats');
        const score = view.getUint32(offset, true); offset += 4;
        const lines = view.getUint16(offset, true); offset += 2;
        const level = view.getUint8(offset++);
        const frags = view.getUint16(offset, true); offset += 2;
        const isAlive = view.getUint8(offset++) === 1;
        const garbagePending = view.getUint8(offset++);
        // v6: awaitingSpawn (late joiner ≠ eliminated). Older streams default to false.
        let awaitingSpawn = false;
        if (version >= 6) {
            awaitingSpawn = view.getUint8(offset++) === 1;
        }

        // === DROP STATE ===
        this._assertAvailable(view, offset, 4, 'player drop state');
        const dropCounter = view.getUint16(offset, true); offset += 2;
        const dropInterval = view.getUint16(offset, true); offset += 2;

        // === GRID ===
        const grid = this._decodeGrid(buffer, view, offset);
        offset += GRID_BYTES;

        // === GARBAGE ROW COLORS (v7+) ===
        if (version >= 7) {
            offset = this._applyGarbageRowColors(view, offset, grid);
        }

        // === CURRENT PIECE ===
        const currentPiece = this._decodePiece(buffer, view, offset);
        offset += 5;

        // === NEXT PIECES ===
        const nextPieceCount = this._readUint8(view, offset++, 'next-piece count');
        if (nextPieceCount > MAX_NEXT_PIECES) {
            throw new Error(`Malformed binary snapshot: next-piece count ${nextPieceCount} exceeds ${MAX_NEXT_PIECES}`);
        }
        this._assertAvailable(view, offset, nextPieceCount, 'next pieces');
        const nextPieces = [];
        for (let i = 0; i < nextPieceCount; i++) {
            const typeIndex = view.getUint8(offset++);
            if (typeIndex > 0 && typeIndex <= PIECE_TYPES.length) {
                nextPieces.push(PIECE_TYPES[typeIndex - 1]);
            }
        }

        // === GARBAGE ENTRIES ===
        const garbageCount = this._readUint8(view, offset++, 'garbage count');
        const garbageEntries = [];
        for (let i = 0; i < garbageCount; i++) {
            const result = this._decodeGarbageEntry(buffer, view, offset, version);
            garbageEntries.push(result.entry);
            offset = result.offset;
        }

        // === LOCKED PIECES (skipped in encoding) ===
        const lockedPieceCount = this._readUint8(view, offset++, 'locked-piece count');
        if (lockedPieceCount !== 0) {
            throw new Error('Malformed binary snapshot: locked pieces are not encoded in binary-v1');
        }
        const lockedPieces = this._reconstructLockedPiecesFromGrid(grid);

        // === BLIND TIMERS (8 bytes) ===
        const blindResult = this._decodeBlindTimers(view, offset);
        const blindTimers = blindResult.timers;
        offset = blindResult.offset;

        return {
            player: {
                steamId: steamId.value,
                name: name.value,
                color: color.value,
                score,
                lines,
                level,
                frags,
                isAlive,
                awaitingSpawn,
                garbagePending,
                dropCounter,
                dropInterval,
                grid,
                currentPiece,
                nextPieces,
                garbageEntries,
                lockedPieces,
                blindTimers,
            },
            offset,
        };
    }

    /**
     * Decode the game grid
     */
    _decodeGrid(buffer, view, offset) {
        this._assertAvailable(view, offset, GRID_BYTES, 'grid');
        const grid = [];

        let byteIndex = 0;
        for (let y = 0; y < GRID_ROWS; y++) {
            grid[y] = [];
            for (let x = 0; x < GRID_COLS; x += 2) {
                const byte = view.getUint8(offset + byteIndex);
                const cell1Type = (byte >> 4) & 0x0F;
                const cell2Type = byte & 0x0F;

                grid[y][x] = this._decodeCell(cell1Type);
                grid[y][x + 1] = this._decodeCell(cell2Type);

                byteIndex++;
            }
        }

        return grid;
    }

    _decodeCell(cellTypeIndex) {
        if (cellTypeIndex <= 0) return null;
        const encodedType = CELL_TYPES[cellTypeIndex] || 'empty';
        let type = encodedType;
        let isGarbage = false;
        if (encodedType === 'garbage') {
            type = 'GARBAGE';
            isGarbage = true;
        } else if (encodedType === 'clean_garbage') {
            type = 'CLEAN_GARBAGE';
            isGarbage = true;
        }
        // Both garbage variants render as the SAME themed grey. The grid codec packs
        // only a 4-bit type index (no per-cell color), so we must not hand the renderer
        // a distinct literal grey for CLEAN_GARBAGE — the v4 'clean_garbage' type made it
        // decode to COLORS.CLEAN_GARBAGE (#a0a0a0), which the board's resolveColor treats
        // as a "custom" color and renders literally (skipping the theme), so clean vs
        // normal garbage showed as two mismatched greys. Pin both to the GARBAGE color so
        // resolveColor themes them uniformly. (Per-attacker garbage tint = future work,
        // carried on the garbage ENTRY, not the packed grid.)
        return {
            type,
            shapeKey: type,
            color: isGarbage ? (COLORS.GARBAGE || '#808080') : (COLORS[type] || COLORS.GARBAGE || '#808080'),
        };
    }

    _reconstructLockedPiecesFromGrid(grid) {
        if (!Array.isArray(grid)) return [];

        const pieces = [];
        for (let y = 0; y < grid.length; y += 1) {
            const row = grid[y];
            if (!Array.isArray(row)) continue;
            for (let x = 0; x < row.length; x += 1) {
                const cell = row[x];
                if (!cell) continue;
                pieces.push({
                    type: cell.type,
                    shapeKey: cell.shapeKey || cell.type,
                    shape: [[1]],
                    x,
                    y,
                    color: cell.color || COLORS[cell.type] || COLORS.GARBAGE,
                    pieceId: `grid-${y}-${x}`,
                });
            }
        }
        return pieces;
    }

    /**
     * Decode a piece
     */
    _decodePiece(buffer, view, offset) {
        this._assertAvailable(view, offset, 5, 'piece');
        const typeIndex = view.getUint8(offset);
        if (typeIndex === 0) {
            return null; // No piece
        }
        if (typeIndex > PIECE_TYPES.length) {
            throw new Error(`Malformed binary snapshot: invalid piece type ${typeIndex}`);
        }

        return {
            type: PIECE_TYPES[typeIndex - 1],
            shapeKey: PIECE_TYPES[typeIndex - 1],
            shape: SHAPES[PIECE_TYPES[typeIndex - 1]],
            color: COLORS[PIECE_TYPES[typeIndex - 1]],
            x: view.getUint8(offset + 1) - 128,
            y: view.getUint8(offset + 2) - 128,
            rotation: view.getUint8(offset + 3),
        };
    }

    _decodeBlindTimers(view, offset) {
        this._assertAvailable(view, offset, 8, 'blind timers');
        const field = view.getUint16(offset, true) / 100; offset += 2;
        const fieldMax = view.getUint16(offset, true) / 100; offset += 2;
        const pending = view.getUint16(offset, true) / 100; offset += 2;
        const pendingMax = view.getUint16(offset, true) / 100; offset += 2;

        return {
            timers: {
                field, fieldMax, pending, pendingMax,
            },
            offset,
        };
    }

    /**
     * Decode a garbage entry
     */
    _decodeGarbageEntry(buffer, view, offset, version = FORMAT_VERSION) {
        const entryBytes = version >= 5
            ? GARBAGE_ENTRY_FIXED_BYTES_V5
            : (version >= 4 ? GARBAGE_ENTRY_FIXED_BYTES_V4 : GARBAGE_ENTRY_BYTES_V3);
        this._assertAvailable(view, offset, entryBytes, 'garbage entry');
        const typeByte = view.getUint8(offset++);
        const typeVal = typeByte & 0x03;
        const holeHi = (typeByte >> 2) & 0x03;
        const variant = ((typeByte >> 4) & 0x01) ? 'clean' : 'normal';
        const isLastInBurst = !!((typeByte >> 5) & 0x01);
        let type = 'other';
        if (typeVal === 0) type = 'line';
        else if (typeVal === 1) type = 'blind';
        else if (typeVal === 2) type = 'full_blind';

        const attackerHash = view.getUint32(offset, true); offset += 4;
        const holeMask = view.getUint8(offset++) | (holeHi << 8); // recombine the 10-bit mask

        const durationVal = view.getUint8(offset++);
        const duration = durationVal / 10;

        let attackSeq = 0;
        let lineIndex = 0;
        let createdSimTick = 0;
        let sourceSimTick = 0;
        let sourceLockSeq = 0;
        let applyAfterLockSeq = 0;
        let attackIdText = '';
        let color;
        if (version >= 4) {
            attackSeq = view.getUint32(offset, true); offset += 4;
            lineIndex = view.getUint8(offset++);
            createdSimTick = view.getUint32(offset, true); offset += 4;
            sourceSimTick = view.getUint32(offset, true); offset += 4;
            sourceLockSeq = view.getUint16(offset, true); offset += 2;
            applyAfterLockSeq = view.getUint16(offset, true); offset += 2;
            if (version >= 5) {
                color = this._readColorRGB(view, offset); offset += 3;
            }
            const attackId = this._readString(buffer, view, offset);
            attackIdText = attackId.value;
            offset = attackId.offset;
        }

        // Try to resolve attacker ID from cache
        const attackerId = this._attackerIdCache.get(attackerHash) || `unknown_${attackerHash}`;

        return {
            entry: {
                type,
                attackerId,
                holeMask,
                duration,
                variant,
                isLastInBurst,
                attackSeq,
                attackId: attackIdText || (attackSeq ? `attack_${attackSeq}` : undefined),
                lineIndex,
                createdSimTick,
                sourceSimTick,
                sourceLockSeq,
                applyAfterLockSeq,
                color,
            },
            offset,
        };
    }

    /**
     * Read 3 RGB bytes as a hex color string. All-zero (#000000) → undefined,
     * meaning "no attacker color recorded" so the renderer falls back to grey.
     */
    _readColorRGB(view, offset) {
        const r = view.getUint8(offset);
        const g = view.getUint8(offset + 1);
        const b = view.getUint8(offset + 2);
        if (r === 0 && g === 0 && b === 0) return undefined;
        const hex = (n) => n.toString(16).padStart(2, '0');
        return `#${hex(r)}${hex(g)}${hex(b)}`;
    }

    /**
     * v7: read the per-garbage-row colors written by BinaryEncoder._encodeGarbageRowColors and
     * paint them onto the freshly decoded garbage cells (the 4-bit grid left them grey). Returns
     * the new offset. Mirrors the encoder's 1-byte-count + count*(rowIndex + 3-byte RGB) layout.
     */
    _applyGarbageRowColors(view, offset, grid) {
        const count = this._readUint8(view, offset++, 'garbage-row-color count');
        for (let i = 0; i < count; i++) {
            const rowIndex = this._readUint8(view, offset++, 'garbage-row index');
            const color = this._readColorRGB(view, offset); offset += 3;
            const row = grid && grid[rowIndex];
            if (row) {
                for (let x = 0; x < GRID_COLS; x++) {
                    const cell = row[x];
                    if (cell && (cell.type === 'GARBAGE' || cell.type === 'CLEAN_GARBAGE')) {
                        cell.color = color;
                    }
                }
            }
        }
        return offset;
    }

    /**
     * Read a length-prefixed string
     */
    _readString(buffer, view, offset) {
        const len = this._readUint8(view, offset++, 'string length');
        this._assertAvailable(view, offset, len, 'string value');
        const bytes = new Uint8Array(buffer, offset, len);
        const value = new TextDecoder().decode(bytes);
        return { value, offset: offset + len };
    }

    /**
     * Simple string hash (must match encoder)
     */
    _hashString(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash &= hash;
        }
        return hash >>> 0;
    }

    /**
     * Fallback: decode JSON
     * @param {ArrayBuffer} buffer
     * @returns {BinaryStateSnapshotV7|null}
     */
    _decodeFromJson(buffer) {
        try {
            const text = new TextDecoder().decode(buffer);
            const parsed = JSON.parse(text);
            if (
                !isRecord(parsed)
                || !Array.isArray(parsed.players)
                || parsed.players.length > MAX_BINARY_PLAYERS
                || !parsed.players.every(isPackedPlayerSnapshot)
                || !GAME_PHASES.includes(parsed.gamePhase)
                || !Number.isFinite(parsed.timestamp)
                || !Number.isFinite(parsed.tick)
                || !Number.isFinite(parsed.simTick)
                || !Number.isFinite(parsed.snapshotSeq)
                || !(
                    parsed.winner === null
                    || (isRecord(parsed.winner)
                        && (typeof parsed.winner.steamId === 'string' || parsed.winner.steamId === null)
                        && typeof parsed.winner.name === 'string')
                )
            ) {
                throw new TypeError('JSON snapshot does not match the state contract');
            }
            return {
                players: parsed.players.map(copyPackedPlayerSnapshot),
                gamePhase: parsed.gamePhase,
                winner: parsed.winner,
                timestamp: parsed.timestamp,
                tick: parsed.tick,
                simTick: parsed.simTick,
                snapshotSeq: parsed.snapshotSeq,
            };
        } catch (e) {
            console.error('Failed to decode snapshot:', e);
            return null;
        }
    }
}

/**
 * Singleton instances for convenience
 */
let _encoder = null;
let _decoder = null;

export function getBinaryEncoder() {
    if (!_encoder) {
        _encoder = new BinaryEncoder();
    }
    return _encoder;
}

export function getBinaryDecoder() {
    if (!_decoder) {
        _decoder = new BinaryDecoder();
    }
    return _decoder;
}

/**
 * Utility: Calculate snapshot size in bytes
 */
export function calculateSnapshotSize(snapshot) {
    const encoder = getBinaryEncoder();
    const buffer = encoder.encodeSnapshot(snapshot);
    return buffer.byteLength;
}

/**
 * Utility: Compare JSON vs Binary size
 */
export function compareEncodingSizes(snapshot) {
    const jsonSize = new TextEncoder().encode(JSON.stringify(snapshot)).length;
    const encoder = getBinaryEncoder();
    const binarySize = encoder.encodeSnapshot(snapshot).byteLength;

    return {
        jsonSize,
        binarySize,
        reduction: Math.round((1 - binarySize / jsonSize) * 100),
    };
}
