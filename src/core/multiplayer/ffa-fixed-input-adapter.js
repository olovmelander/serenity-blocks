import { INPUT_DISPOSITIONS } from '../simulation-tick.js';

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

function updateLastInputSequence(player, seq) {
    if (seq && seq > (player.lastInputSeq || 0)) {
        player.lastInputSeq = seq;
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
} = {}) {
    const bufferedByCommand = new WeakMap();
    const callbacksByPlayer = new Map();

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
            const player = game.players.get(playerId);
            const inputs = bufferedInputs?.get(playerId);
            if (game.isHost && player?.isAlive && Array.isArray(inputs)) {
                inputs.forEach((input, index) => {
                    const command = toCanonicalCommand(input, context.tick, index);
                    if (!command) return;
                    game.inputValidator?.trackInput?.(playerId, input.type, input.data);
                    bufferedByCommand.set(command, input);
                    context.emit(command);
                });
            }

            if (playerId !== game.localPlayerId) return;
            game._fixedInputTimeMs += context.tickMs;
            const previousStamp = game._activeFixedInputStamp;
            game._activeFixedInputStamp = peerInputSimTick === null ? null : {
                simTick: peerInputSimTick,
                ordinal: context.tick,
            };
            try {
                game.localInputHooks.advanceFixed?.(context);
                game.localInputHooks.advance?.(game._fixedInputTimeMs, context.tickMs);
            } finally {
                game._activeFixedInputStamp = previousStamp || null;
            }
        },

        applyInput(playerId, command) {
            if (!bufferedByCommand.has(command)) {
                if (playerId !== game.localPlayerId) return false;
                return game.localInputHooks.applyFixed?.(command) ?? false;
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
            const player = game.players.get(playerId);
            if (!player) return;

            result.input.forEach(({ command, disposition }) => {
                const bufferedInput = bufferedByCommand.get(command);
                if (!bufferedInput) return;
                const seq = bufferedInput.data?.seq;
                // The jitter frame has been consumed regardless of simulation
                // disposition. Advance the max ACK now so deferred/rejected
                // commands cannot keep peer reconciliation permanently behind.
                updateLastInputSequence(player, seq);

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
            });
        },
    };
}
