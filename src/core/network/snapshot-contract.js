// @ts-check

/**
 * Deep-copy a 2-D shape/row grid one level down (rows sliced, primitive cells by
 * value). Used for piece `shape` matrices.
 * @param {any} rows
 * @returns {any}
 */
function copyRows(rows) {
    if (!Array.isArray(rows)) return rows;
    const out = new Array(rows.length);
    for (let i = 0; i < rows.length; i++) {
        out[i] = Array.isArray(rows[i]) ? rows[i].slice() : rows[i];
    }
    return out;
}

/**
 * Deep-copy a board grid down to the cell-object level. Cells are mutable
 * `{ type, shapeKey, color }` objects and consumers both replace row entries
 * (`rebuildBoardGridFromPieces`) and can write cell fields in place, so the copy
 * must clone rows AND cells — a shallow row-copy would leave cell objects aliased.
 * @param {any} grid
 * @returns {any}
 */
function copyGridDeep(grid) {
    if (!Array.isArray(grid)) return grid;
    const rows = new Array(grid.length);
    for (let y = 0; y < grid.length; y++) {
        const row = grid[y];
        if (!Array.isArray(row)) { rows[y] = row; continue; }
        const out = new Array(row.length);
        for (let x = 0; x < row.length; x++) {
            const cell = row[x];
            out[x] = cell && typeof cell === 'object' ? { ...cell } : cell;
        }
        rows[y] = out;
    }
    return rows;
}

/**
 * Deep-copy a tetromino record, isolating its `shape` matrix.
 * @param {any} piece
 * @returns {any}
 */
function copyPiece(piece) {
    if (!piece || typeof piece !== 'object') return piece;
    return { ...piece, shape: copyRows(piece.shape) };
}

/**
 * Turn the packed binary-v7 body into the explicit shape accepted by the live
 * snapshot consumer.
 *
 * Steam networking retains the raw `snapshot` (a decoded keyframe, or a delta
 * reconstructed against one) as the delta baseline for future frames, and the
 * live consumer adopts some nested arrays BY REFERENCE and then mutates them —
 * so the returned object must not alias the retained baseline on any mutable
 * nested field, or the next delta reconstruction is poisoned (a silent desync).
 * This is why the copy is load-bearing and fully deep.
 *
 * P0-8 (review §2.9): the previous `structuredClone(snapshot)` cloned the WHOLE
 * world (incl. the immutable top-level) through the slow structured-clone path on
 * every receive (~1 MB/s churn on peers → GC tail). This does the SAME deep
 * isolation with a targeted hand-rolled copy: only the per-player mutable
 * containers are cloned (grid to the cell level, `lockedPieces`/`currentPiece`
 * to the shape level, `nextPieces`, `blindTimers`), the immutable top-level
 * fields are shared by reference, and `structuredClone` is used only for the
 * small variable-depth `garbageEntries` (whose `clearSummary` nesting is not
 * fixed). Isolation is byte-equivalent to the old clone — pinned by the contract
 * test — but faster and lighter on the dominant grid field.
 *
 * @param {BinaryStateSnapshotV7} snapshot
 * @param {SnapshotHydrationMetadata} [metadata]
 * @returns {StateSnapshot}
 */
export function hydrateBinarySnapshot(snapshot, metadata = {}) {
    const acknowledgements = metadata.acknowledgements || {};

    return {
        ...snapshot,
        players: snapshot.players.map((player) => ({
            ...player,
            grid: copyGridDeep(player.grid),
            currentPiece: copyPiece(player.currentPiece),
            nextPieces: Array.isArray(player.nextPieces) ? player.nextPieces.slice() : player.nextPieces,
            garbageEntries: Array.isArray(player.garbageEntries)
                ? structuredClone(player.garbageEntries)
                : player.garbageEntries,
            lockedPieces: Array.isArray(player.lockedPieces)
                ? player.lockedPieces.map(copyPiece)
                : player.lockedPieces,
            blindTimers: player.blindTimers ? { ...player.blindTimers } : player.blindTimers,
            lastInputSeq: acknowledgements[player.steamId],
            lastAttackerId: undefined,
            lockSeq: undefined,
        })),
        roundGeneration: metadata.roundGeneration,
        migrationEpoch: metadata.migrationEpoch,
        digest: metadata.digest,
        hotPotatoState: metadata.hotPotatoState === undefined
            ? undefined
            : structuredClone(metadata.hotPotatoState),
    };
}
