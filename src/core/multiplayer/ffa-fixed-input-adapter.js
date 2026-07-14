import { INPUT_DISPOSITIONS } from '../simulation-tick.js';
import { acknowledgeFfaInput } from './ffa-input-batching.js';

function inputQueueSize(queue) {
    if (Array.isArray(queue)) return queue.length;
    return queue ? 1 : 0;
}

function toCanonicalCommand(input, tick, subframe) {
    const seq = Number(input?.data?.seq);
    const base = {
        tick,
        subframe: Math.min(9, Math.max(0, subframe)),
        source: 'edge',
        edgeSequence: Number.isInteger(seq) && seq >= 0 ? seq : null,
    };

    if (input?.type === 'move' && (input.data?.direction === -1 || input.data?.direction === 1)) {
        return { ...base, action: 'move', value: input.data.direction };
    }
    if (
        input?.type === 'rotate'
        && ['left', 'right', 'flip'].includes(input.data?.direction)
    ) {
        return { ...base, action: 'rotate', value: input.data.direction };
    }
    if (input?.type === 'drop' && input.data?.type === 'soft') {
        return { ...base, action: 'softDrop', value: null };
    }
    if (input?.type === 'drop' && input.data?.type === 'hard') {
        return { ...base, action: 'hardDrop', value: null };
    }
    return null;
}

function fromCanonicalCommand(command) {
    switch (command?.action) {
    case 'move':
        return { type: 'move', data: { direction: command.value } };
    case 'rotate':
        return { type: 'rotate', data: { direction: command.value } };
    case 'softDrop':
        return { type: 'drop', data: { type: 'soft' } };
    case 'hardDrop':
        return { type: 'drop', data: { type: 'hard' } };
    default:
        return null;
    }
}

/** Consume, but do not apply, the host's current fixed-tick input frame. */
export function takeFfaFixedBufferedInputs(game) {
    if (!game?.isHost || !game.useJitterBuffer || !game.inputJitterBuffer) return null;
    return game.inputJitterBuffer.getInputsForTick();
}

/** Advance the jitter cursor once after a consumed fixed input frame finishes. */
export function finishFfaFixedBufferedInputs(game, bufferedInputs) {
    if (bufferedInputs === null) return;
    game.inputJitterBuffer?.advanceTick?.();
}

/**
 * Build the per-player adapter consumed by UnifiedMultiplayerLoop. Buffered
 * commands emit during advanceTick's input phase; result processing preserves
 * FFA's existing sequence acknowledgement and telemetry contract.
 */
export function createFfaFixedInputAdapter(game, {
    bufferedInputs = null,
    peerInputSimTick = null,
    shouldContinue = null,
} = {}) {
    const bufferedByCommand = new WeakMap();
    const callbacksByPlayer = new Map();
    const ownershipContinues = () => !shouldContinue || shouldContinue();

    const getCallbacks = (playerId) => {
        if (!callbacksByPlayer.has(playerId)) {
            callbacksByPlayer.set(
                playerId,
                playerId === game.localPlayerId
                    ? game.buildPhysicsCallbacks(playerId)
                    : game.buildRemotePlayerCallbacks(playerId),
            );
        }
        return callbacksByPlayer.get(playerId);
    };

    return {
        advanceInput(playerId, context) {
            if (!ownershipContinues()) return;
            const player = game.players.get(playerId);
            const inputs = bufferedInputs?.get(playerId);
            if (game.isHost && player && !player.isAlive && Array.isArray(inputs)) {
                inputs.forEach((input) => acknowledgeFfaInput(player, input.data?.seq));
            }
            if (game.isHost && player?.isAlive && Array.isArray(inputs)) {
                for (let index = 0; index < inputs.length; index += 1) {
                    if (!ownershipContinues()) return;
                    const input = inputs[index];
                    const command = toCanonicalCommand(input, context.tick, index);
                    if (!command) continue;
                    game.inputValidator?.trackInput?.(playerId, input.type, input.data);
                    if (!ownershipContinues()) return;
                    bufferedByCommand.set(command, input);
                    context.emit(command);
                    if (!ownershipContinues()) return;
                }
            }

            if (playerId !== game.localPlayerId || !ownershipContinues()) return;
            game._fixedInputTimeMs += context.tickMs;
            const previousStamp = game._activeFixedInputStamp;
            game._activeFixedInputStamp = peerInputSimTick === null ? null : {
                simTick: peerInputSimTick,
                ordinal: context.tick,
            };
            try {
                if (!ownershipContinues()) return;
                game.localInputHooks.advanceFixed?.(context);
                if (!ownershipContinues()) return;
                game.localInputHooks.advance?.(game._fixedInputTimeMs, context.tickMs);
            } finally {
                if (ownershipContinues()) {
                    game._activeFixedInputStamp = previousStamp || null;
                }
            }
        },

        applyInput(playerId, command) {
            if (!ownershipContinues()) return false;
            if (!bufferedByCommand.has(command)) {
                if (playerId !== game.localPlayerId) return false;
                const applied = game.localInputHooks.applyFixed?.(command) ?? false;
                return ownershipContinues() ? applied : false;
            }

            const mapped = fromCanonicalCommand(command);
            const player = game.players.get(playerId);
            if (!mapped || !player?.isAlive) return false;

            const beforeQueueSize = inputQueueSize(player.gameState.inputQueue);
            const applied = game._applyInputToPlayer(
                playerId,
                mapped.type,
                mapped.data,
                getCallbacks(playerId),
                { fixedTick: true, inputPhase: true },
            );
            if (!ownershipContinues()) return false;
            if (applied) return true;

            const afterQueueSize = inputQueueSize(player.gameState.inputQueue);
            if (
                (mapped.type === 'move' || mapped.type === 'rotate')
                && afterQueueSize > beforeQueueSize
            ) {
                return INPUT_DISPOSITIONS.DEFERRED_PHYSICS;
            }
            return false;
        },

        onTickResult(playerId, result) {
            if (!ownershipContinues()) return;
            const player = game.players.get(playerId);
            if (!player) return;

            for (const { command, disposition } of result.input) {
                if (!ownershipContinues()) return;
                const bufferedInput = bufferedByCommand.get(command);
                if (!bufferedInput) continue;
                const seq = bufferedInput.data?.seq;
                // The jitter frame has been consumed regardless of simulation
                // disposition. Advance only the contiguous ACK prefix so a
                // later command cannot conceal an earlier missing command.
                acknowledgeFfaInput(player, seq);

                if (disposition === INPUT_DISPOSITIONS.APPLIED) {
                    game._recordNetEvent?.('input_applied', {
                        steamId: playerId,
                        inputType: bufferedInput.type,
                        seq,
                        buffered: true,
                        tick: bufferedInput._tick,
                    });
                } else if (disposition === INPUT_DISPOSITIONS.REJECTED_HIT_STOP) {
                    game._recordNetEvent?.('input_rejected', {
                        steamId: playerId,
                        inputType: bufferedInput.type,
                        seq,
                        reason: 'hit_stop',
                    });
                } else if (disposition === INPUT_DISPOSITIONS.DEFERRED_PHYSICS) {
                    game._recordNetEvent?.('input_deferred', {
                        steamId: playerId,
                        inputType: bufferedInput.type,
                        seq,
                        reason: 'physics_busy',
                    });
                } else {
                    game._recordNetEvent?.('input_rejected', {
                        steamId: playerId,
                        inputType: bufferedInput.type,
                        seq,
                        reason: 'physics_busy',
                    });
                }
            }
        },
    };
}
