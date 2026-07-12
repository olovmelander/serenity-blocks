import { MessageTypes } from '../network/message-types.js';
import {
    PLAYER_INPUT_EDGE_CAPACITY,
    PLAYER_INPUT_REPEAT_CAPACITY_PER_TICK,
} from '../player-input-state.js';

export const FFA_INPUT_BATCH_LIMIT = 20;
const MAX_FIXED_STEPS_PER_FLUSH = 5;
export const FFA_INPUT_GROUP_LIMIT = PLAYER_INPUT_EDGE_CAPACITY
    + (PLAYER_INPUT_REPEAT_CAPACITY_PER_TICK * MAX_FIXED_STEPS_PER_FLUSH);
export const FFA_INPUT_GROUP_CHUNK_LIMIT = Math.ceil(
    FFA_INPUT_GROUP_LIMIT / FFA_INPUT_BATCH_LIMIT,
);
export const FFA_INPUT_ORDINAL_SPAN_LIMIT = MAX_FIXED_STEPS_PER_FLUSH;
export const FFA_INPUT_PER_ORDINAL_LIMIT = PLAYER_INPUT_EDGE_CAPACITY
    + PLAYER_INPUT_REPEAT_CAPACITY_PER_TICK;
export const FFA_FIXED_INPUT_FUTURE_TICKS = 32;
export const FFA_FIXED_INPUT_PENDING_GROUP_LIMIT = 256;
export const FFA_FIXED_INPUT_PENDING_COMMAND_LIMIT = 4096;
const FFA_FIXED_INPUT_REBASE_LEAD_TICKS = 4;

const hostGroupsByGame = new WeakMap();
const hostProgressByGame = new WeakMap();
const hostPendingGroupsByGame = new WeakMap();

function fixedTickBaseOrdinal(inputs) {
    const ordinals = inputs.map((input) => Number(input.fixedTickOrdinal))
        .filter((ordinal) => Number.isInteger(ordinal) && ordinal >= 0);
    return ordinals.length > 0 ? Math.min(...ordinals) : null;
}

function getPeerFlushGroup(game) {
    const active = game._pendingFfaInputGroup;
    if (
        active
        && Number.isInteger(active.remaining)
        && active.remaining > 0
        && active.remaining <= game.pendingInputs.length
    ) return active;

    const size = Math.min(game.pendingInputs.length, FFA_INPUT_GROUP_LIMIT);
    const id = (Number(game._ffaInputGroupSequence) || 0) + 1;
    const group = {
        id,
        remaining: size,
        chunkCount: Math.ceil(size / FFA_INPUT_BATCH_LIMIT),
        nextChunkIndex: 0,
        roundGeneration: Math.max(0, Math.floor(Number(game.roundGeneration) || 0)),
        fixedTickBaseOrdinal: fixedTickBaseOrdinal(game.pendingInputs.slice(0, size)),
    };
    game._ffaInputGroupSequence = id;
    game._pendingFfaInputGroup = group;
    return group;
}

/** Resolve one ordinal anchor for old single packets and reassembled groups. */
export function resolveFfaInputBatchBaseOrdinal(inputs, batchData, fixedTickEnabled) {
    if (fixedTickEnabled !== true) return null;
    const declared = batchData?.fixedTickBaseOrdinal == null
        ? NaN
        : Number(batchData.fixedTickBaseOrdinal);
    if (Number.isInteger(declared) && declared >= 0) return declared;
    return fixedTickBaseOrdinal(inputs);
}

/** Grant the canonical rate policy only to one structurally bounded fixed flush. */
export function validateFfaFixedInputGroup(inputs, batchData, fixedTickEnabled) {
    if (fixedTickEnabled !== true) return { valid: false, reason: 'fixed_tick_disabled' };
    if (!Array.isArray(inputs) || inputs.length === 0 || inputs.length > FFA_INPUT_GROUP_LIMIT) {
        return { valid: false, reason: 'fixed_input_group_size' };
    }

    const groupId = Number(batchData?.fixedTickGroupId);
    const chunkCount = Number(batchData?.fixedTickGroupChunkCount);
    const roundGeneration = Number(batchData?.fixedTickRoundGeneration);
    if (
        !Number.isSafeInteger(groupId)
        || groupId < 0
        || !Number.isSafeInteger(chunkCount)
        || chunkCount < 1
        || chunkCount > FFA_INPUT_GROUP_CHUNK_LIMIT
        || !Number.isSafeInteger(roundGeneration)
        || roundGeneration < 0
    ) return { valid: false, reason: 'fixed_input_group_metadata' };

    let previousOrdinal = -1;
    let previousSequence = null;
    let firstSimTick = null;
    let previousSimTick = null;
    let edgeOnlyCount = 0;
    const countsByOrdinal = new Map();
    for (const input of inputs) {
        const ordinal = Number(input?.fixedTickOrdinal);
        const sequence = Number(input?.seq);
        const simTick = Number(input?.simTick);
        const validMove = input?.type === 'move'
            && (input.data?.direction === -1 || input.data?.direction === 1);
        const validRotate = input?.type === 'rotate'
            && ['left', 'right', 'flip'].includes(input.data?.direction);
        const validDrop = input?.type === 'drop'
            && ['soft', 'hard'].includes(input.data?.type);
        if (
            !Number.isSafeInteger(ordinal)
            || ordinal < 0
            || ordinal < previousOrdinal
            || !Number.isSafeInteger(sequence)
            || sequence < 1
            || (previousSequence !== null && sequence !== previousSequence + 1)
            || !Number.isSafeInteger(simTick)
            || simTick < 0
            || (!validMove && !validRotate && !validDrop)
        ) return { valid: false, reason: 'fixed_input_order' };

        if (firstSimTick === null) firstSimTick = simTick;
        const firstOrdinal = Number(inputs[0].fixedTickOrdinal);
        if (simTick - firstSimTick !== ordinal - firstOrdinal) {
            return { valid: false, reason: 'fixed_input_sim_tick' };
        }
        if (previousOrdinal === ordinal && previousSimTick !== simTick) {
            return { valid: false, reason: 'fixed_input_sim_tick' };
        }

        const ordinalCount = (countsByOrdinal.get(ordinal) || 0) + 1;
        if (ordinalCount > FFA_INPUT_PER_ORDINAL_LIMIT) {
            return { valid: false, reason: 'fixed_input_ordinal_size' };
        }
        countsByOrdinal.set(ordinal, ordinalCount);
        if (validRotate || (validDrop && input.data.type === 'hard')) edgeOnlyCount += 1;
        previousOrdinal = ordinal;
        previousSequence = sequence;
        previousSimTick = simTick;
    }

    const firstOrdinal = Number(inputs[0].fixedTickOrdinal);
    const declaredBase = batchData.fixedTickBaseOrdinal == null
        ? NaN
        : Number(batchData.fixedTickBaseOrdinal);
    if (
        declaredBase !== firstOrdinal
        || previousOrdinal - firstOrdinal >= FFA_INPUT_ORDINAL_SPAN_LIMIT
    ) return { valid: false, reason: 'fixed_input_ordinal_span' };

    const producerLimit = PLAYER_INPUT_EDGE_CAPACITY
        + (PLAYER_INPUT_REPEAT_CAPACITY_PER_TICK * countsByOrdinal.size);
    if (inputs.length > producerLimit || edgeOnlyCount > PLAYER_INPUT_EDGE_CAPACITY) {
        return { valid: false, reason: 'fixed_input_producer_shape' };
    }

    return {
        valid: true,
        reason: null,
        metrics: {
            groupId,
            roundGeneration,
            firstOrdinal,
            lastOrdinal: previousOrdinal,
            firstSequence: Number(inputs[0].seq),
            lastSequence: previousSequence,
            firstSimTick,
            lastSimTick: previousSimTick,
        },
    };
}

function getHostProgress(game) {
    let progress = hostProgressByGame.get(game);
    if (!progress) {
        progress = new Map();
        hostProgressByGame.set(game, progress);
    }
    return progress;
}

function readNonNegativeClock(value, fallback = 0) {
    const numeric = Number(value);
    return Math.max(0, Math.floor(Number.isFinite(numeric) ? numeric : fallback));
}

function validateFfaFixedInputProgress(game, steamId, fixedGroup) {
    if (!fixedGroup.valid || !fixedGroup.metrics) return fixedGroup;
    const { metrics } = fixedGroup;
    const progressByPeer = getHostProgress(game);
    const previous = progressByPeer.get(steamId);
    if (metrics.roundGeneration !== Math.max(0, Math.floor(Number(game.roundGeneration) || 0))) {
        return { valid: false, reason: 'fixed_input_round' };
    }

    if (!previous) {
        const lastAppliedSequence = Number(game.players?.get?.(steamId)?.lastInputSeq ?? 0);
        if (
            !Number.isSafeInteger(lastAppliedSequence)
            || lastAppliedSequence < 0
            || metrics.firstSequence !== lastAppliedSequence + 1
        ) {
            return {
                valid: false,
                reason: 'fixed_input_progression',
                fatal: !Number.isSafeInteger(lastAppliedSequence)
                    || metrics.firstSequence > lastAppliedSequence + 1,
            };
        }
    }

    if (previous) {
        const sameRound = metrics.roundGeneration === previous.roundGeneration;
        if (
            metrics.groupId <= previous.groupId
            || metrics.firstSequence <= previous.lastSequence
        ) return { valid: false, reason: 'fixed_input_progression', fatal: false };
        if (
            metrics.firstSimTick <= previous.lastSimTick
            || (sameRound && metrics.groupId !== previous.groupId + 1)
            || (sameRound && metrics.firstSequence !== previous.lastSequence + 1)
            || (sameRound && metrics.firstOrdinal <= previous.lastOrdinal)
            || (sameRound
                && metrics.firstSimTick - previous.lastSimTick
                    !== metrics.firstOrdinal - previous.lastOrdinal)
        ) return { valid: false, reason: 'fixed_input_progression', fatal: true };
    }

    const bufferTick = Number(game.inputJitterBuffer?.currentTick);
    const bufferCurrentTick = readNonNegativeClock(
        bufferTick,
        readNonNegativeClock(game.simTick),
    );
    const processCursor = readNonNegativeClock(
        game.inputJitterBuffer?.processCursor,
        bufferCurrentTick,
    );
    const groupSpan = metrics.lastSimTick - metrics.firstSimTick;
    const sameRound = previous?.roundGeneration === metrics.roundGeneration;
    const bufferClockEpoch = readNonNegativeClock(game.inputJitterBuffer?.clockEpoch);
    const bufferClockReset = sameRound
        && (
            previous.bufferClockEpoch !== bufferClockEpoch
            || (Number.isFinite(previous.bufferCurrentTick)
                && bufferCurrentTick < previous.bufferCurrentTick)
        );
    const previousPending = sameRound
        && !bufferClockReset
        && previous.lastScheduleTick >= processCursor;
    let firstScheduleTick = sameRound && !bufferClockReset
        ? previous.lastScheduleTick + (metrics.firstSimTick - previous.lastSimTick)
        : bufferCurrentTick;
    if (
        previous
        && !previousPending
        && (
            firstScheduleTick < processCursor
            || firstScheduleTick > bufferCurrentTick + FFA_FIXED_INPUT_REBASE_LEAD_TICKS
        )
    ) firstScheduleTick = bufferCurrentTick;
    if (previousPending) firstScheduleTick = Math.max(firstScheduleTick, previous.lastScheduleTick + 1);
    firstScheduleTick = Math.max(firstScheduleTick, processCursor);
    const lastScheduleTick = firstScheduleTick + groupSpan;
    if (lastScheduleTick > bufferCurrentTick + FFA_FIXED_INPUT_FUTURE_TICKS) {
        return { valid: false, reason: 'fixed_input_schedule_window' };
    }

    return {
        valid: true,
        reason: null,
        metrics: {
            ...metrics,
            firstScheduleTick,
            lastScheduleTick,
            bufferCurrentTick,
            bufferClockEpoch,
        },
    };
}

function commitFfaFixedInputProgress(game, steamId, fixedGroup) {
    if (fixedGroup.valid && fixedGroup.metrics) {
        getHostProgress(game).set(steamId, fixedGroup.metrics);
    }
}

/** Clear transport continuity when a peer identity leaves this game object. */
export function resetFfaInputTransport(game, steamId = null) {
    const groups = hostGroupsByGame.get(game);
    const progress = hostProgressByGame.get(game);
    const pending = hostPendingGroupsByGame.get(game);
    if (steamId == null) {
        groups?.clear();
        progress?.clear();
        pending?.clear();
        hostGroupsByGame.delete(game);
        hostProgressByGame.delete(game);
        hostPendingGroupsByGame.delete(game);
        return;
    }
    groups?.delete(steamId);
    progress?.delete(steamId);
    pending?.delete(steamId);
}

/** Discard unsent/reconciliation input from a board generation that just ended. */
export function resetFfaInputProducer(game) {
    if (Array.isArray(game?.pendingInputs)) game.pendingInputs.length = 0;
    if (Array.isArray(game?.inputHistory)) game.inputHistory.length = 0;
    if (game) {
        game.inputSequence = 0;
        game._ffaInputGroupSequence = 0;
        game._pendingFfaInputGroup = null;
    }
}

/** Start a fresh per-round input sequence and discard all prior transport state. */
export function resetFfaInputEpoch(game) {
    resetFfaInputProducer(game);
    resetFfaInputTransport(game);
    game?.players?.forEach((player) => { player.lastInputSeq = 0; });
}

/** Flush ordered peer inputs without exceeding the host's validation cap. */
export function flushFfaInputBatches(game) {
    if (!Array.isArray(game?.pendingInputs) || game.pendingInputs.length === 0) return 0;

    let sent = 0;
    while (game.pendingInputs.length > 0) {
        const group = getPeerFlushGroup(game);
        const count = Math.min(FFA_INPUT_BATCH_LIMIT, group.remaining);
        const inputs = game.pendingInputs.slice(0, count);
        const groupFinal = group.nextChunkIndex === group.chunkCount - 1;
        game.network.sendP2PMessage(game.network.hostSteamId, MessageTypes.GAME_INPUT_BATCH, {
            inputs,
            lastAck: game.lastAckedTick,
            tick: game.hostTick,
            simTick: game.simTick || 0,
            fixedTickBaseOrdinal: group.fixedTickBaseOrdinal,
            fixedTickGroupId: group.id,
            fixedTickRoundGeneration: group.roundGeneration,
            fixedTickGroupChunkIndex: group.nextChunkIndex,
            fixedTickGroupChunkCount: group.chunkCount,
            fixedTickGroupFinal: groupFinal,
        });
        game.pendingInputs.splice(0, inputs.length);
        group.remaining -= inputs.length;
        group.nextChunkIndex += 1;
        if (groupFinal) game._pendingFfaInputGroup = null;
        sent += 1;
    }
    return sent;
}

/** Reassemble one bounded peer flush before any input reaches host scheduling. */
export function assembleFfaInputBatch(game, steamId, batchData, packetInputs) {
    const groupId = Number(batchData?.fixedTickGroupId);
    if (!Number.isInteger(groupId) || groupId < 0) return packetInputs;

    const chunkIndex = Number(batchData.fixedTickGroupChunkIndex);
    const chunkCount = Number(batchData.fixedTickGroupChunkCount);
    const expectedFinal = chunkIndex === chunkCount - 1;
    const validMetadata = Number.isInteger(chunkIndex)
        && Number.isInteger(chunkCount)
        && chunkCount > 0
        && chunkCount <= FFA_INPUT_GROUP_CHUNK_LIMIT
        && chunkIndex >= 0
        && chunkIndex < chunkCount
        && batchData.fixedTickGroupFinal === expectedFinal
        && packetInputs.length > 0
        && (expectedFinal || packetInputs.length === FFA_INPUT_BATCH_LIMIT);
    if (!validMetadata) {
        game._recordNetEvent?.('input_rejected', {
            steamId,
            reason: 'input_group_metadata',
        });
        return null;
    }

    let groups = hostGroupsByGame.get(game);
    if (!groups) {
        groups = new Map();
        hostGroupsByGame.set(game, groups);
    }
    let group = groups.get(steamId);
    if (!group || group.id !== groupId) {
        if (group && group.chunks.size !== group.chunkCount) {
            game._recordNetEvent?.('input_rejected', {
                steamId,
                reason: 'input_group_superseded',
            });
        }
        group = {
            id: groupId,
            chunkCount,
            chunks: new Map(),
            inputCount: 0,
            rejected: false,
            roundGeneration: batchData.fixedTickRoundGeneration,
            fixedTickBaseOrdinal: batchData.fixedTickBaseOrdinal,
        };
        groups.set(steamId, group);
    }

    if (
        group.chunkCount !== chunkCount
        || group.roundGeneration !== batchData.fixedTickRoundGeneration
        || group.fixedTickBaseOrdinal !== batchData.fixedTickBaseOrdinal
        || group.chunks.has(chunkIndex)
    ) {
        group.rejected = true;
        game._recordNetEvent?.('input_rejected', {
            steamId,
            reason: 'input_group_inconsistent',
        });
    }
    if (!group.chunks.has(chunkIndex)) {
        group.chunks.set(chunkIndex, packetInputs);
        group.inputCount += packetInputs.length;
    }
    if (group.inputCount > FFA_INPUT_GROUP_LIMIT) group.rejected = true;

    if (group.chunks.size !== group.chunkCount) return null;
    groups.delete(steamId);
    if (group.rejected || group.inputCount > FFA_INPUT_GROUP_LIMIT) {
        game._recordNetEvent?.('input_rejected', {
            steamId,
            reason: 'input_group_rejected',
        });
        return null;
    }
    batchData.fixedTickBaseOrdinal = group.fixedTickBaseOrdinal;
    return Array.from(
        { length: group.chunkCount },
        (_, index) => group.chunks.get(index),
    ).flat();
}

function recordFixedInputRejection(game, steamId, reason) {
    game._recordNetEvent?.('input_rejected', { steamId, reason });
}

function dispatchFfaInputGroup(game, steamId, inputs, batchData, timestamp, fixedGroup) {
    commitFfaFixedInputProgress(game, steamId, fixedGroup);
    const seqs = inputs.map((input) => Number(input.seq)).filter((seq) => Number.isFinite(seq));
    const firstFixedOrdinal = resolveFfaInputBatchBaseOrdinal(
        inputs,
        batchData,
        game._fixedTickEnabled,
    );
    game._recordNetEvent?.('input_batch_accepted', {
        steamId,
        count: inputs.length,
        minSeq: seqs.length ? Math.min(...seqs) : null,
        maxSeq: seqs.length ? Math.max(...seqs) : null,
        clientTick: batchData.tick,
        lastAck: batchData.lastAck,
    });

    inputs.forEach((input) => {
        if (!['move', 'rotate', 'drop'].includes(input.type)) return;
        const fixedTickOrdinal = Number(input.fixedTickOrdinal);
        const fixedTickOffset = firstFixedOrdinal !== null
            && Number.isInteger(fixedTickOrdinal)
            && fixedTickOrdinal >= firstFixedOrdinal
            ? fixedTickOrdinal - firstFixedOrdinal
            : undefined;
        const fixedTickTargetTick = fixedGroup.valid
            ? fixedGroup.metrics.firstScheduleTick
                + (Number(input.simTick) - fixedGroup.metrics.firstSimTick)
            : undefined;
        game.processPlayerInput(
            steamId,
            input.type,
            {
                ...(input.data || {}),
                seq: input.seq,
                tick: input.tick,
                simTick: input.simTick ?? batchData.simTick,
                fixedTickOrdinal: Number.isInteger(fixedTickOrdinal)
                    ? fixedTickOrdinal
                    : undefined,
                fixedTickOffset,
                fixedTickCanonical: fixedGroup.valid,
                fixedTickTargetTick,
                fixedTickFutureAllowance: fixedGroup.valid
                    ? FFA_FIXED_INPUT_FUTURE_TICKS
                    : undefined,
            },
            input.timestamp || timestamp,
            { fixedTickCanonical: fixedGroup.valid },
        );
    });
}

function getHostPendingGroups(game) {
    let pending = hostPendingGroupsByGame.get(game);
    if (!pending) {
        pending = new Map();
        hostPendingGroupsByGame.set(game, pending);
    }
    return pending;
}

/** Drain complete canonical groups as host scheduling capacity becomes available. */
export function drainFfaInputBatches(game, onlySteamId = null) {
    const pending = hostPendingGroupsByGame.get(game);
    if (!game?.isHost || !pending) return 0;
    const steamIds = onlySteamId == null ? Array.from(pending.keys()) : [onlySteamId];
    let accepted = 0;

    steamIds.forEach((steamId) => {
        const queue = pending.get(steamId);
        while (queue?.length > 0) {
            const group = queue[0];
            const fixedGroup = validateFfaFixedInputProgress(
                game,
                steamId,
                group.fixedGroup,
            );
            if (!fixedGroup.valid && fixedGroup.reason === 'fixed_input_schedule_window') break;
            queue.shift();
            if (!fixedGroup.valid) {
                recordFixedInputRejection(game, steamId, fixedGroup.reason);
                if (fixedGroup.fatal) {
                    queue.length = 0;
                    game.kickPlayer?.(steamId, 'fixed_input_continuity_gap');
                    break;
                }
                continue;
            }
            dispatchFfaInputGroup(
                game,
                steamId,
                group.inputs,
                group.batchData,
                group.timestamp,
                fixedGroup,
            );
            accepted += 1;
        }
        if (queue?.length === 0) pending.delete(steamId);
    });
    return accepted;
}

/** Validate, reassemble, schedule, and rate-brand one peer input packet. */
export function processFfaInputBatch(game, steamId, batchData, timestamp) {
    if (!game?.isHost) return;
    const packetInputs = batchData?.inputs;
    if (!Array.isArray(packetInputs)) return;
    if (packetInputs.length > FFA_INPUT_BATCH_LIMIT) {
        console.warn(`[FFA] Batch too large from ${steamId}: ${packetInputs.length}`);
        return;
    }

    if (batchData.fixedTickGroupId != null) {
        const packetRound = Number(batchData.fixedTickRoundGeneration);
        const hostRound = Math.max(0, Math.floor(Number(game.roundGeneration) || 0));
        if (!Number.isSafeInteger(packetRound) || packetRound !== hostRound) {
            recordFixedInputRejection(game, steamId, 'fixed_input_round');
            return;
        }
    }

    const inputs = assembleFfaInputBatch(game, steamId, batchData, packetInputs);
    if (!inputs) return;
    const fixedGroup = validateFfaFixedInputGroup(inputs, batchData, game._fixedTickEnabled);
    if (game._fixedTickEnabled === true && batchData.fixedTickGroupId != null) {
        if (!fixedGroup.valid) {
            recordFixedInputRejection(game, steamId, fixedGroup.reason);
            return;
        }
        const pending = getHostPendingGroups(game);
        const queue = pending.get(steamId) || [];
        const duplicatePending = queue.some((group) => (
            group.fixedGroup.metrics.groupId === fixedGroup.metrics.groupId
            && group.fixedGroup.metrics.roundGeneration === fixedGroup.metrics.roundGeneration
        ));
        if (duplicatePending) {
            recordFixedInputRejection(game, steamId, 'fixed_input_pending_duplicate');
            return;
        }
        const pendingCommands = queue.reduce((total, group) => total + group.inputs.length, 0);
        if (
            queue.length >= FFA_FIXED_INPUT_PENDING_GROUP_LIMIT
            || pendingCommands + inputs.length > FFA_FIXED_INPUT_PENDING_COMMAND_LIMIT
        ) {
            recordFixedInputRejection(game, steamId, 'fixed_input_pending_overflow');
            game.kickPlayer?.(steamId, 'fixed_input_backpressure_overflow');
            return;
        }
        queue.push({
            inputs,
            batchData,
            timestamp,
            fixedGroup,
        });
        pending.set(steamId, queue);
        drainFfaInputBatches(game, steamId);
        return;
    }

    dispatchFfaInputGroup(game, steamId, inputs, batchData, timestamp, fixedGroup);
}
