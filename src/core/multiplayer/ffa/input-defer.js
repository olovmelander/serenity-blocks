// @ts-check

/**
 * P0-4 (ONLINE_MP_PERFORMANCE_REVIEW_2026-07-18 §2.6) — defer inputs that arrive while
 * physics owns the board, instead of ACK-and-discarding hard drops.
 *
 * Before this, a peer that hard-dropped through a line clear had its drop silently discarded
 * by the host during the ~100–300 ms cascade window (while the sequence was ACKed anyway).
 * With `peerLocalSim` on the peer had already applied the drop locally → the boards diverged
 * until the desync backstop fired a full-board resync (a visible snap + a beat of frozen input).
 *
 * These helpers are shared by BOTH the host (remote-player apply) and the peer (local
 * prediction) — see `_applyInputToPlayer`, which both roles call. Symmetry is load-bearing:
 * if only one side deferred the drop, that alone would MANUFACTURE the divergence this removes.
 */

// Matches the `applyBufferedInputs` consumer in game.js, which splices the first 4 queued
// move/rotate actions at spawn. Producing more than the consumer drains would silently lose
// the excess, so the cap stays 4 for move/rotate. The deferred hard drop below is tracked by
// a separate one-shot flag, so a time-compressed remote burst's DROP is never queue-capped.
const MOVE_QUEUE_CAP = 4;

/**
 * Queue a move/rotate while physics owns the piece, and mark a pending hard drop so it lands
 * on the next spawned piece (dedup: at most one).
 *
 * Soft-drop toggles are intentionally NOT deferred — a held soft-drop replayed at spawn would
 * produce an unexpected fast piece, which is never what the player intended mid-cascade.
 *
 * @param {any} gameState
 * @param {string} inputType
 * @param {any} data
 */
export function queueInputDuringPhysics(gameState, inputType, data) {
    if (inputType === 'move' || inputType === 'rotate') {
        const queued = { type: inputType, dir: data.direction };
        if (Array.isArray(gameState.inputQueue)) {
            if (gameState.inputQueue.length < MOVE_QUEUE_CAP) gameState.inputQueue.push(queued);
        } else if (gameState.inputQueue) {
            gameState.inputQueue = [gameState.inputQueue, queued].slice(0, MOVE_QUEUE_CAP);
        } else {
            gameState.inputQueue = queued;
        }
    } else if (inputType === 'drop' && data?.type === 'hard') {
        // Dedup: a second hard drop arriving while one is pending is ignored — two hard drops
        // on one future piece is never intended.
        gameState._deferredHardDrop = true;
    }
}

/**
 * Apply a deferred hard drop to the freshly-spawned piece, using the role-appropriate physics
 * callbacks so the resulting lock routes garbage/effects/next-spawn exactly like a live drop
 * (a callback-less `hardDrop` would lock the piece but never schedule the cascade or the next
 * spawn — see `lockPiece`'s `if (physicsCallbacks)` guard in game.js).
 *
 * Called from every spawn hook both roles use: the host's `_spawnNextPieceForPlayer` and the
 * peer's local-prediction spawn callback. The one-shot flag is cleared before applying, so the
 * re-entrant lock→physics→spawn chain cannot loop.
 *
 * @param {any} game - the FFAGameStateP2P instance
 * @param {string} steamId
 */
export function applyDeferredHardDrop(game, steamId) {
    const player = game.players.get(steamId);
    if (!player) return;
    const gs = player.gameState;
    if (gs._deferredHardDrop !== true) return;
    gs._deferredHardDrop = false;
    if (!player.isAlive || !gs.currentPiece || gs.isProcessingPhysics) return;
    const callbacks = game.isHost
        ? (steamId === game.localPlayerId
            ? game.buildPhysicsCallbacks(steamId)
            : game.buildRemotePlayerCallbacks(steamId))
        : game.buildLocalPredictionCallbacks(steamId);
    game._applyInputToPlayer(steamId, 'drop', { type: 'hard' }, callbacks);
}
