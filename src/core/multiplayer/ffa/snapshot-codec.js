// @ts-check

/**
 * FFA snapshot codec — the authoritative-snapshot BUILD, digest, and
 * change-detection side of the wire contract (Phase 6A.2 extraction from
 * `ffa-p2p-game-state.js`). These are the drift-prone sites the plan calls out:
 * a field the sim reads that is not built here is a future desync.
 *
 * Pure-move: the functions take the FFA game-state instance (`game`) and the
 * god-class methods delegate to them as thin compatibility wrappers, so the
 * public surface (`buildStateSnapshot`, `_calculateStateDigest`,
 * `hasSignificantStateChanges`) is byte-identical. The apply side
 * (`_applySnapshotState`) is a deliberately-separate later slice — it writes
 * live state and carries more risk than this read-only build side.
 */

/**
 * Build the authoritative multi-player snapshot broadcast by the host.
 * @param {any} game - the FFAGameStateP2P instance
 * @returns {AuthoritativeStateSnapshot}
 */
export function buildStateSnapshot(game) {
    const players = Array.from(game.players.entries()).map(([steamId, player]) => ({
        steamId,
        name: player.name,
        color: player.color,
        score: player.gameState.score,
        lines: player.gameState.lines,
        level: player.gameState.level,
        frags: player.frags,
        isAlive: player.isAlive,
        awaitingSpawn: player.awaitingSpawn === true, // late joiner waiting to spawn (≠ eliminated)
        garbagePending: player.garbageQueue.getTotalLines(),
        lastAttackerId: player.lastAttackerId || null,
        lockSeq: player._lockSeq || 0,
        grid: player.gameState.boardGrid,
        currentPiece: player.gameState.currentPiece,
        nextPieces: player.gameState.nextPieces,
        dropCounter: player.gameState.dropCounter,
        dropInterval: player.gameState.dropInterval,
        garbageEntries: player.garbageQueue.entries.map((entry) => ({
            type: entry.type,
            attackerId: entry.attackerId,
            attackerName: entry.attackerName,
            color: entry.color,
            holeMask: entry.holeMask,
            variant: entry.variant,
            duration: entry.duration,
            isLastInBurst: entry.isLastInBurst === true,
            attackId: entry.attackId,
            attackSeq: entry.attackSeq,
            lineIndex: entry.lineIndex,
            targetId: entry.targetId,
            createdSimTick: entry.createdSimTick,
            sourceSimTick: entry.sourceSimTick,
            sourceLockSeq: entry.sourceLockSeq,
            applyAfterLockSeq: entry.applyAfterLockSeq,
            applySimTick: entry.applySimTick,
            rulesHash: entry.rulesHash,
            clearSummary: entry.clearSummary,
        })),
        lockedPieces: player.gameState.lockedPieces.map((piece) => ({
            x: piece.x,
            y: piece.y,
            shape: piece.shape,
            color: piece.color,
            shapeKey: piece.shapeKey,
        })),
        blindTimers: player.gameState.blindTimers ? {
            field: player.gameState.blindTimers.field,
            fieldMax: player.gameState.blindTimers.fieldMax,
            pending: player.gameState.blindTimers.pending,
            pendingMax: player.gameState.blindTimers.pendingMax,
        } : null,
        lastInputSeq: player.lastInputSeq,
    }));
    // Phase 4: Calculate state digest for desync detection
    const stateDigest = calculateStateDigest(players);
    return {
        players,
        gamePhase: game.gamePhase,
        roundGeneration: game.roundGeneration, // fence: peers drop snapshots from an older round
        hotPotatoState: game.hotPotatoState ? { ...game.hotPotatoState } : null,
        winner: game.winner ? {
            steamId: game.winner.steamId,
            name: game.winner.name,
        } : null,
        timestamp: Date.now(),
        tick: game.hostTick,
        simTick: game.simTick,
        snapshotSeq: game.snapshotSeq,
        migrationEpoch: game.migrationEpoch || 0,
        // Phase 4: State digest for desync detection
        digest: stateDigest,
    };
}

/**
 * Phase 4: Calculate a digest of the critical game state for desync detection.
 * Uses a simple DJB2 hash of scores, frags, and alive status — fast to compute.
 * Pure: depends only on the passed players array.
 * @param {Array<any>} players
 * @returns {string}
 */
export function calculateStateDigest(players) {
    // Build a string of critical state values
    const stateString = players
        .sort((a, b) => a.steamId.localeCompare(b.steamId)) // Deterministic order
        .map((p) => `${p.steamId}:${p.score}:${p.lines}:${p.frags}:${p.isAlive ? 1 : 0}:${p.garbagePending}`)
        .join('|');

    // Simple hash (DJB2 algorithm)
    let hash = 5381;
    for (let i = 0; i < stateString.length; i++) {
        hash = ((hash << 5) + hash) + stateString.charCodeAt(i);
        hash &= hash; // Convert to 32-bit integer
    }
    return (hash >>> 0).toString(16); // Unsigned hex string
}

/**
 * Check if any player state has changed significantly since the last broadcast.
 * Used to avoid broadcasting when nothing has changed.
 * @param {any} game - the FFAGameStateP2P instance
 * @returns {boolean}
 */
export function hasSignificantStateChanges(game) {
    if (!game.isHost) return false;

    for (const [steamId, player] of game.players) {
        // P0-5 (review §2.7): a line clear / cascade is an async multi-frame ANIMATION.
        // Throughout it currentPiece is null and score/lines/dropCounter are frozen, so the
        // field comparison below sees "no change" and broadcasts pause for the whole clear —
        // peers then freeze and teleport on every multi-line clear. Treat an in-progress
        // cascade on any ALIVE player as "changed" so the 30Hz accumulator
        // (maybeBroadcastPostPhysics) keeps the animation flowing. Gated on isProcessingPhysics
        // actually being true, so a fully idle game still returns false (never forces broadcasts).
        if (player.isAlive && player.gameState.isProcessingPhysics === true) {
            return true;
        }

        const lastState = game.lastBroadcastState.get(steamId);

        if (!lastState) {
            return true; // No previous state, so broadcast
        }

        const currentState = player.gameState;

        // Check for significant changes
        const hasChanges = (
            lastState.score !== currentState.score
            || lastState.lines !== currentState.lines
            || lastState.level !== currentState.level
            || lastState.currentPieceY !== currentState.currentPiece?.y
            || lastState.currentPieceX !== currentState.currentPiece?.x
            || lastState.dropCounter !== currentState.dropCounter
            || lastState.garbagePending !== player.garbageQueue.getTotalLines()
            || player.frags !== lastState.frags
            || player.isAlive !== lastState.isAlive
            || lastState.hotPotatoGeneration !== (game.hotPotatoState?.generation || 0)
        );

        if (hasChanges) {
            return true;
        }
    }

    return false; // No changes detected
}
