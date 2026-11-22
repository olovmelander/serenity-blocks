// Pending garbage going into a board before its next piece, online (versus-rules.js): on the
// host for every player, and on a peer for its own predicted board. Blind entries at the head
// of the queue are taken first (blind.js); the rows go in through the one garbage boundary
// (applyGarbage) by the versus rules, and the attack of rows a garbage settle completes is sent
// the way the player's own clears are. Functions take the FFAGameStateP2P.

import { applyGarbage } from '../../game.js';
import { takeSpawnBlinds } from '../../blind.js';
import { emitMultiplayerEvent, MULTIPLAYER_EVENTS } from '../../../events/multiplayer-events.js';
import { VERSUS_GARBAGE_OPTIONS } from '../versus-rules.js';
import { noteCopyClear } from './attack-request.js';
import { drainAllLineBursts, garbageBurstKey } from './garbage-helpers.js';

/**
* Insert pending garbage for a player (after piece spawns)
* HOST ONLY
*/
export function insertPendingGarbage(game, steamId) {
    if (!game.isHost) return;

    const player = game.players.get(steamId);
    if (!player || !player.isAlive) return;

    const { garbageQueue } = player;

    // Blind attacks at the head of the queue (blind.js), exactly as the peer takes them on
    // its own board: a full blind hides the board now, a blind piece hides the piece
    // spawning now once it lands. Rows behind them still go in below.
    takeSpawnBlinds(player.gameState, garbageQueue);

    const totalLines = garbageQueue.getTotalLines();

    if (totalLines === 0) return;

    game._logGarbage(`💥 Inserting ${totalLines} garbage lines for ${player.name}`);
    game._logGarbage(`💥 Queue has ${garbageQueue.entries.length} total entries before dequeue`);

    // Take lines from queue — DRAIN-ALL to match local (one dump), else one burst.
    const burst = game._garbageDrainAll
        ? drainAllLineBursts(garbageQueue)
        : garbageQueue.dequeueLineBurst();

    if (!burst || burst.length === 0) return;

    game._logGarbage(`💥 Dequeued ${burst.length} entries from garbage queue`);

    // Log all entries in burst to debug attackerId
    burst.forEach((entry, idx) => {
        game._logGarbage(`  Entry ${idx}: type=${entry.type}, attackerId=${entry.attackerId || 'MISSING'}, color=${entry.color}`);
    });

    // Whose rows these are (logs only). The frag goes to the holder of the player's frag
    // credit, fed as each attack arrives (FFAAttackRouter.sendGarbageToPlayer).
    const attackerId = burst[burst.length - 1].attackerId
        || burst.find((entry) => entry.attackerId)?.attackerId || null;
    const killerId = player.lastAttackerId || null;
    const killerName = killerId ? (game.players.get(killerId)?.name || null) : null;
    const isSelfKill = !killerId || killerId === steamId;

    // Board mutation + grid/cache repair live in the ONE boundary (§5.1). Versus garbage
    // never tops a player out (only a blocked spawn does), and rows its settle completes
    // count as the player's own clear (versus-rules.js).
    const result = applyGarbage(player.gameState, burst, {
        ...VERSUS_GARBAGE_OPTIONS,
        debug: game.debugGarbage,
    });

    if (!result || result.topOut) {
        game._logGarbage(`💀 ${player.name} topped out from garbage insertion!`);
        player.isAlive = false;
        player.gameState.isGameOver = true;
        game._recordNetEvent?.('garbage_inserted', {
            targetSteamId: steamId,
            targetName: player.name,
            lines: burst.length,
            attackerId,
            topOut: true,
        });

        game.fragTracker.recordDeath(steamId, killerId, killerName);
        game._recordNetEvent?.('death', {
            deadSteamId: steamId,
            deadName: player.name,
            killerSteamId: killerId,
            killerName,
            reason: 'garbage_insert',
        });

        emitMultiplayerEvent(MULTIPLAYER_EVENTS.PLAYER_TOPPED_OUT, {
            steamId,
            playerName: player.name,
            killer: killerId,
            killerId,
            killerName,
            isSelfKill,
            isLocal: steamId === game.localPlayerId,
        });
        return;
    }

    // PHASE 3.2: Dispatch garbage insertion event for visual effects
    emitMultiplayerEvent(MULTIPLAYER_EVENTS.GARBAGE_INSERTED, {
        steamId,
        playerName: player.name,
        linesInserted: burst.length,
        isLocal: steamId === game.localPlayerId,
    });
    game._recordNetEvent?.('garbage_inserted', {
        targetSteamId: steamId,
        targetName: player.name,
        lines: burst.length,
        attackerId,
        topOut: false,
    });

    if (result.settleSummary) routeSettleAttack(game, steamId, result.settleSummary);
}

/**
 * Send the attack of rows a garbage settle completed, the way this player's own clears are
 * sent: the host routes its own (and, with authoritative attacks, everyone's); otherwise a
 * peer reports its own and the host's copy only notes the clear it will check that against.
 * @param {string} steamId
 * @param {Object} summary cascade summary from applyGarbage (settleSummary)
 */
export function routeSettleAttack(game, steamId, summary) {
    if (game.isHost) {
        if (steamId === game.localPlayerId || game._authoritativeAttacksEnabled) {
            game._recordNetEvent?.('attack_ready', { attackerSteamId: steamId, cascadeSummary: summary });
            game.attackRouter.routeAttack(steamId, summary);
        } else {
            noteCopyClear(game, steamId, summary);
        }
    } else if (steamId === game.localPlayerId) {
        game.sendGarbageAttack(summary);
    }
}

/**
 * Insert garbage locally for visual prediction (peers only)
 * Host's broadcast will overwrite with authoritative state
 */
// Stable identity for a garbage line across the peer's predicted consume and the
// host's serialized queue. attackId is `r{round}-a{seq}` (always non-empty for routed
// attacks); lineIndex disambiguates lines within one attack. Falls back to attackSeq.
export function insertLocalGarbagePrediction(game, steamId) {
    if (game.isHost) return; // Host uses _spawnNextPieceForPlayer

    const player = game.players.get(steamId);
    if (!player || !player.isAlive) return;

    const { garbageQueue, gameState } = player;
    // Blind attacks at the head of the queue, on our own board exactly as the host takes
    // them on its copy (blind.js takeSpawnBlinds); the host's snapshot no longer lists them
    // once it has too.
    const blinds = takeSpawnBlinds(gameState, garbageQueue);
    if (game._garbageIdempotentEnabled) blinds.forEach((e) => game._peerConsumedBursts?.add(garbageBurstKey(e)));
    const totalLines = garbageQueue.getTotalLines();

    if (totalLines > 0) {
        // Take lines from queue and insert locally — DRAIN-ALL to match local (one
        // dump), else one burst. Both host and peer flip together via the flag.
        const burst = game._garbageDrainAll
            ? drainAllLineBursts(garbageQueue)
            : garbageQueue.dequeueLineBurst();
        if (burst && burst.length > 0) {
            // Idempotent-adopt: remember these bursts so the next host snapshot (which
            // still lists them until the host consumes them ~½RTT later) does NOT re-add
            // them in _applySnapshotState → no double-insert / meter rebound.
            if (game._garbageIdempotentEnabled && game._peerConsumedBursts) {
                for (const entry of burst) game._peerConsumedBursts.add(garbageBurstKey(entry));
            }
            const normalizedBurst = burst.map((entry) => ({
                ...entry,
                holeMask: typeof entry.holeMask === 'number' ? entry.holeMask : 0,
                variant: entry.variant || 'normal',
            }));

            // Board mutation + grid/cache repair live in the ONE boundary (§5.1), by the
            // same versus rules as the host. Death is host-authoritative; the attack of
            // rows the settle completed is reported like any other clear of ours.
            const result = applyGarbage(gameState, normalizedBurst, {
                ...VERSUS_GARBAGE_OPTIONS,
                debug: game.debugGarbage,
            });
            if (result?.settleSummary) routeSettleAttack(game, steamId, result.settleSummary);

            // Dispatch event for UI feedback
            emitMultiplayerEvent(MULTIPLAYER_EVENTS.GARBAGE_INSERTED, {
                steamId,
                playerName: player.name,
                linesInserted: burst.length,
                isLocal: true,
            });
        }
    }

    // Trigger render to show the garbage
    game.renderAllPlayers();
}
