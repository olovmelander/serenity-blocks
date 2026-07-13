// @ts-check

import { getBinaryDecoder } from '../../network/binary-encoding.js';
import { MessageTypes } from '../../network/message-types.js';
import { hydrateBinarySnapshot } from '../../network/snapshot-contract.js';
import { computeFfaJoinSyncpoint } from './join-syncpoint.js';
import { resetHostResyncRetries } from './resync-retry-policy.js';
import { validateFfaResyncSidecar } from './resync-sidecar.js';

/**
 * Build the runtime adapter consumed by the extracted resync coordinator.
 * Keeping transport/codec ownership here prevents those dependencies from
 * leaking back into the coordinator or expanding the staged FFA owner.
 * @param {import('./resync-coordinator.js').ResyncState & Record<string, any>} game
 * @returns {import('./resync-coordinator.js').ResyncContext}
 */
export function createFfaResyncContext(game) {
    return {
        state: game,
        now: () => Date.now(),
        createTransferId: () => `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
        scheduleInterval: (callback, intervalMs) => setInterval(callback, intervalMs),
        clearInterval: (timer) => clearInterval(timer),
        scheduleTimeout: (callback, timeoutMs) => setTimeout(callback, timeoutMs),
        clearTimeout: (timer) => clearTimeout(timer),
        buildPayload: (meta) => game._buildResyncPayload(meta),
        sendWindow: (transfer) => game._sendResyncWindow(transfer),
        dispatchChunk: (transfer, chunk) => game._sendResyncChunk(transfer, chunk),
        sendChunkMessage: (steamId, chunk) => {
            game.network.sendP2PMessage(steamId, MessageTypes.GAME_STATE_RESYNC, chunk);
        },
        tickTransfer: (transfer) => game._tickResyncTransfer(transfer),
        sendAck: (data) => {
            game.network.sendP2PMessage(
                game.network.hostSteamId,
                MessageTypes.GAME_STATE_RESYNC_ACK,
                data,
            );
        },
        decodeSnapshot: (buffer) => getBinaryDecoder().decodeSnapshot(buffer),
        hydrateSnapshot: (snapshot, metadata) => hydrateBinarySnapshot(
            /** @type {any} */ (snapshot),
            metadata,
        ),
        validateSidecar: (sidecar, context) => validateFfaResyncSidecar(sidecar, context),
        setIncomingBaseline: (from, snapshot) => {
            game.network.setIncomingSnapshotBaseline?.(
                from || game.network.hostSteamId,
                snapshot,
            );
        },
        applyState: (state) => game._applyResyncState(state),
        canApplyState: () => (
            !game._disposed
            && !game.isHost
            && computeFfaJoinSyncpoint(game).safe
        ),
        recordEvent: (event, details) => game._recordNetEvent?.(event, details),
        transitionJoin: (event, details) => game._transitionJoin(event, details),
        forceNextKeyframe: (steamId) => game.network.forceNextSnapshotKeyframe?.(steamId),
        onTransferCompleted: (transfer) => resetHostResyncRetries(game, transfer.steamId),
    };
}
