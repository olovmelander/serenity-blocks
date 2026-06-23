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
const FORMAT_VERSION = 3; // v3: garbage type-byte packs holeMask[8:9] + variant + isLastInBurst

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
const GAME_PHASES = ['waiting', 'countdown', 'playing', 'finished'];
const GAME_PHASE_MAP = new Map(GAME_PHASES.map((phase, i) => [phase, i]));

// Grid dimensions
const GRID_COLS = 10;
const GRID_ROWS = 24; // Including hidden rows
const GRID_BYTES = GRID_COLS * GRID_ROWS / 2;
const MAX_BINARY_PLAYERS = 8;
const MAX_NEXT_PIECES = 32;

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
     * @param {Object} snapshot - The snapshot from buildStateSnapshot()
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
        // Header: 12 bytes (magic + version + playerCount + gamePhase + tick + timestamp)
        // Per player: ~2KB (max garbage 255 * 6 = 1530 bytes + grid 120 + stats/names)
        const estimatedSize = 32 + (playerCount * 2048);
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
        const estimatedSize = 32 + (playerCount * 2048); // Same buffer safety
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
     * Encode a single player's delta
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
        }

        if (mask & DELTA_FLAGS.DROPS) {
            view.setUint16(offset, Math.min(current.dropCounter || 0, 65535), true); offset += 2;
            view.setUint16(offset, Math.min(current.dropInterval || 1000, 65535), true); offset += 2;
        }

        if (mask & DELTA_FLAGS.GRID) {
            offset = this._encodeGrid(buffer, view, offset, current.grid);
        }

        if (mask & DELTA_FLAGS.PIECE) {
            offset = this._encodePiece(buffer, view, offset, current.currentPiece);
        }

        if (mask & DELTA_FLAGS.NEXT) {
            const nextPieces = current.nextPieces || [];
            view.setUint8(offset++, nextPieces.length);
            for (const piece of nextPieces) {
                const typeIndex = PIECE_TYPE_MAP.get(piece?.type || piece) || 0;
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
     * Encode a single player's state
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

        // === STATS (16 bytes) ===
        view.setUint32(offset, player.score || 0, true); offset += 4;
        view.setUint16(offset, player.lines || 0, true); offset += 2;
        view.setUint8(offset++, player.level || 1);
        view.setUint16(offset, player.frags || 0, true); offset += 2;
        view.setUint8(offset++, player.isAlive ? 1 : 0);
        view.setUint8(offset++, Math.min(player.garbagePending || 0, 255));

        // === DROP STATE (4 bytes) ===
        view.setUint16(offset, Math.min(player.dropCounter || 0, 65535), true); offset += 2;
        view.setUint16(offset, Math.min(player.dropInterval || 1000, 65535), true); offset += 2;

        // === GRID (120 bytes - 2 cells per byte) ===
        offset = this._encodeGrid(buffer, view, offset, player.grid);

        // === CURRENT PIECE (5 bytes) ===
        offset = this._encodePiece(buffer, view, offset, player.currentPiece);

        // === NEXT PIECES (variable, typically 5-7 pieces) ===
        const nextPieces = player.nextPieces || [];
        view.setUint8(offset++, nextPieces.length);
        for (const piece of nextPieces) {
            const typeIndex = PIECE_TYPE_MAP.get(piece?.type || piece) || 0;
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

    /**
     * Encode a garbage entry (7 bytes)
     */
    _encodeGarbageEntry(buffer, view, offset, entry) {
        if (!entry) {
            for (let i = 0; i < 7; i++) view.setUint8(offset + i, 0);
            return offset + 7;
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

        return offset;
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
     * @returns {Object} Decoded snapshot
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
        if (magic !== BINARY_MAGIC) {
            // Not binary format, try JSON fallback
            return this._decodeFromJson(buffer);
        }

        const version = view.getUint8(offset++);
        if (version !== FORMAT_VERSION) {
            console.warn(`Binary format version mismatch: expected ${FORMAT_VERSION}, got ${version}`);
        }

        const playerCount = view.getUint8(offset++);
        if (playerCount > MAX_BINARY_PLAYERS) {
            throw new Error(`Malformed binary snapshot: player count ${playerCount} exceeds ${MAX_BINARY_PLAYERS}`);
        }
        const gamePhaseIndex = view.getUint8(offset++);
        offset++; // Reserved byte
        const tick = view.getUint32(offset, true); offset += 4;

        const gamePhase = GAME_PHASES[gamePhaseIndex] || 'waiting';

        // === DELTA CHECK ===
        // If magic matches DELTA_MAGIC, we need a baseline to decode against.
        // But this decodeSnapshot method signature only takes buffer.
        // We need a separate decodeDeltaSnapshot method for clarity.
        if (magic === DELTA_MAGIC) {
            throw new Error('Use decodeDeltaSnapshot for delta packets');
        }

        // === PLAYER DATA ===
        const players = [];
        for (let i = 0; i < playerCount; i++) {
            const result = this._decodePlayer(buffer, view, offset);
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

        return {
            players,
            gamePhase,
            winner,
            timestamp: Date.now(),
            tick,
        };
    }

    /**
     * Decode a delta snapshot using a baseline state
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
        const playerCount = view.getUint8(offset++);
        if (playerCount > MAX_BINARY_PLAYERS) {
            throw new Error(`Malformed binary delta: player count ${playerCount} exceeds ${MAX_BINARY_PLAYERS}`);
        }
        const gamePhaseIndex = view.getUint8(offset++);
        offset++; // Reserved
        const tick = view.getUint32(offset, true); offset += 4;
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

            const result = this._decodePlayerDelta(buffer, view, offset, basePlayer);
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

        return {
            players,
            gamePhase,
            winner,
            timestamp: Date.now(),
            tick,
        };
    }

    _decodePlayerDelta(buffer, view, offset, basePlayer) {
        const mask = this._readUint8(view, offset++, 'player delta mask');
        const p = { ...basePlayer }; // Start with clone of baseline

        // Stats
        if (mask & DELTA_FLAGS.STATS) {
            this._assertAvailable(view, offset, 11, 'player delta stats');
            p.score = view.getUint32(offset, true); offset += 4;
            p.lines = view.getUint16(offset, true); offset += 2;
            p.level = view.getUint8(offset++);
            p.frags = view.getUint16(offset, true); offset += 2;
            p.isAlive = view.getUint8(offset++) === 1;
            p.garbagePending = view.getUint8(offset++);
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
            p.lockedPieces = this._reconstructLockedPiecesFromGrid(p.grid);
            offset += GRID_BYTES;
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
                    nextPieces.push({ type: PIECE_TYPES[typeIndex - 1] });
                }
            }
            p.nextPieces = nextPieces;
        }

        // Garbage
        if (mask & DELTA_FLAGS.GARBAGE) {
            const garbageCount = this._readUint8(view, offset++, 'player delta garbage count');
            const garbageEntries = [];
            for (let i = 0; i < garbageCount; i++) {
                const result = this._decodeGarbageEntry(buffer, view, offset);
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
     * Decode a single player's state
     */
    _decodePlayer(buffer, view, offset) {
        // === IDENTITY ===
        const steamId = this._readString(buffer, view, offset);
        offset = steamId.offset;
        const name = this._readString(buffer, view, offset);
        offset = name.offset;
        const color = this._readString(buffer, view, offset);
        offset = color.offset;

        // === STATS ===
        this._assertAvailable(view, offset, 11, 'player stats');
        const score = view.getUint32(offset, true); offset += 4;
        const lines = view.getUint16(offset, true); offset += 2;
        const level = view.getUint8(offset++);
        const frags = view.getUint16(offset, true); offset += 2;
        const isAlive = view.getUint8(offset++) === 1;
        const garbagePending = view.getUint8(offset++);

        // === DROP STATE ===
        this._assertAvailable(view, offset, 4, 'player drop state');
        const dropCounter = view.getUint16(offset, true); offset += 2;
        const dropInterval = view.getUint16(offset, true); offset += 2;

        // === GRID ===
        const grid = this._decodeGrid(buffer, view, offset);
        offset += GRID_BYTES;

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
            const result = this._decodeGarbageEntry(buffer, view, offset);
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
        if (encodedType === 'garbage') {
            type = 'GARBAGE';
        } else if (encodedType === 'clean_garbage') {
            type = 'CLEAN_GARBAGE';
        }
        return {
            type,
            shapeKey: type,
            color: COLORS[type] || COLORS.GARBAGE || '#808080',
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
            timers: { field, fieldMax, pending, pendingMax },
            offset
        };
    }

    /**
     * Decode a garbage entry
     */
    _decodeGarbageEntry(buffer, view, offset) {
        this._assertAvailable(view, offset, 7, 'garbage entry');
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
            },
            offset,
        };
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
     */
    _decodeFromJson(buffer) {
        try {
            const text = new TextDecoder().decode(buffer);
            return JSON.parse(text);
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
