import {
    describe, expect, it, vi,
} from 'vitest';
import { MessageTypes } from '../../src/core/network/message-types.js';
import {
    acknowledgeFfaInput,
    assembleFfaInputBatch,
    drainFfaInputBatches,
    FFA_INPUT_BATCH_LIMIT,
    FFA_INPUT_GROUP_LIMIT,
    FFA_INPUT_PER_ORDINAL_LIMIT,
    flushFfaInputBatches,
    processFfaInputBatch,
    resetFfaInputEpoch,
    stageFfaInputRecovery,
    validateFfaFixedInputGroup,
} from '../../src/core/multiplayer/ffa-input-batching.js';
import { planFixedTicks } from '../../src/core/fixed-tick-clock.js';
import {
    advancePlayerInputTick,
    createPlayerInputState,
    enqueueInputEdge,
    PLAYER_INPUT_EDGE_CAPACITY,
} from '../../src/core/player-input-state.js';

function createGame(count) {
    return {
        hostTick: 9,
        lastAckedTick: 7,
        simTick: 11,
        roundGeneration: 2,
        pendingInputs: Array.from({ length: count }, (_, index) => {
            const fixedTickOrdinal = Math.floor(index / 21) + 1;
            return {
                type: 'drop',
                data: { type: 'soft' },
                seq: index + 1,
                fixedTickOrdinal,
                simTick: fixedTickOrdinal + 10,
            };
        }),
        network: {
            hostSteamId: 'HOST',
            sendP2PMessage: vi.fn(),
        },
    };
}

describe('FFA peer input batching', () => {
    it('rejects input from identities outside the authoritative player roster', () => {
        const host = {
            isHost: true,
            localPlayerId: 'HOST',
            players: new Map([['PEER', { isAlive: true, lastInputSeq: 0 }]]),
            processPlayerInput: vi.fn(),
            queueResync: vi.fn(),
            _recordNetEvent: vi.fn(),
        };

        processFfaInputBatch(host, 'UNKNOWN', {
            inputs: [{ type: 'move', data: { direction: -1 }, seq: 2 }],
        }, 1000);

        expect(host.processPlayerInput).not.toHaveBeenCalled();
        expect(host.queueResync).not.toHaveBeenCalled();
        expect(host._recordNetEvent).toHaveBeenCalledWith('input_rejected', {
            steamId: 'UNKNOWN', reason: 'unknown_peer',
        });
    });

    it('advances the authoritative input ACK only across a contiguous consumed prefix', () => {
        const player = { lastInputSeq: 0 };

        expect(acknowledgeFfaInput(player, 2)).toBe(false);
        expect(player.lastInputSeq).toBe(0);
        expect(acknowledgeFfaInput(player, 1)).toBe(true);
        expect(player.lastInputSeq).toBe(2);
        expect(acknowledgeFfaInput(player, 4)).toBe(false);
        expect(acknowledgeFfaInput(player, 3)).toBe(true);
        expect(player.lastInputSeq).toBe(4);
        expect(acknowledgeFfaInput(player, 5000)).toBe(false);
        expect(player.lastInputSeq).toBe(4);
        expect(player._consumedInputSeqs.size).toBe(0);
    });

    it('restages unique unacknowledged history in sequence order for exact recovery', () => {
        const game = {
            inputSequence: 4,
            inputHistory: [{ seq: 1 }, { seq: 3 }, { seq: 2 }],
            pendingInputs: [{ seq: 3 }, { seq: 4 }],
            _pendingFfaInputGroup: { id: 7, remaining: 2 },
        };

        expect(stageFfaInputRecovery(game)).toBe(4);
        expect(game.pendingInputs.map(({ seq }) => seq)).toEqual([1, 2, 3, 4]);
        expect(game._pendingFfaInputGroup).toBeNull();
    });

    it('splits recovery history at the canonical five-tick span', () => {
        const game = createGame(0);
        game.inputSequence = 6;
        game.inputHistory = Array.from({ length: 6 }, (_, index) => ({
            type: 'drop',
            data: { type: 'soft' },
            seq: index + 1,
            fixedTickOrdinal: index + 1,
            simTick: index + 11,
        }));

        stageFfaInputRecovery(game);
        flushFfaInputBatches(game);

        const payloads = game.network.sendP2PMessage.mock.calls
            .map(([, , payload]) => payload);
        const groupIds = [...new Set(payloads.map(({ fixedTickGroupId }) => fixedTickGroupId))];
        expect(groupIds).toHaveLength(2);
        groupIds.forEach((groupId) => {
            const group = payloads.filter((payload) => payload.fixedTickGroupId === groupId);
            expect(validateFfaFixedInputGroup(
                group.flatMap(({ inputs }) => inputs),
                group.at(-1),
                true,
            )).toMatchObject({ valid: true, reason: null });
        });
        expect(game._ffaInputRecoveryStaged).toBe(false);
    });

    it('starts each round with a fresh producer and host transport epoch', () => {
        const game = {
            pendingInputs: [{ seq: 8 }],
            inputHistory: [{ seq: 8 }],
            inputSequence: 8,
            _ffaInputGroupSequence: 3,
            _pendingFfaInputGroup: { id: 3 },
            players: new Map([['PEER', { lastInputSeq: 8 }]]),
        };

        resetFfaInputEpoch(game);

        expect(game.pendingInputs).toEqual([]);
        expect(game.inputHistory).toEqual([]);
        expect(game.inputSequence).toBe(0);
        expect(game._ffaInputGroupSequence).toBe(0);
        expect(game._pendingFfaInputGroup).toBeNull();
        expect(game.players.get('PEER').lastInputSeq).toBe(0);
    });

    it('fences stale grouped packets before they can poison new-round reassembly', () => {
        const host = {
            isHost: true,
            _fixedTickEnabled: true,
            roundGeneration: 0,
            players: new Map([['PEER', { lastInputSeq: 0 }]]),
            inputJitterBuffer: { currentTick: 0, processCursor: -2 },
            processPlayerInput: vi.fn(),
            _recordNetEvent: vi.fn(),
            kickPlayer: vi.fn(),
        };
        const oldChunk = {
            inputs: Array.from({ length: 20 }, (_, index) => ({
                type: 'drop',
                data: { type: 'soft' },
                seq: index + 1,
                fixedTickOrdinal: 1,
                simTick: 1,
            })),
            fixedTickBaseOrdinal: 1,
            fixedTickGroupId: 1,
            fixedTickRoundGeneration: 0,
            fixedTickGroupChunkIndex: 0,
            fixedTickGroupChunkCount: 2,
            fixedTickGroupFinal: false,
        };
        processFfaInputBatch(host, 'PEER', oldChunk, 1000);

        resetFfaInputEpoch(host);
        host.roundGeneration = 1;
        processFfaInputBatch(host, 'PEER', oldChunk, 1000);

        const fresh = (id) => ({
            inputs: [{
                type: 'drop', data: { type: 'soft' }, seq: id, fixedTickOrdinal: id, simTick: id,
            }],
            fixedTickBaseOrdinal: id,
            fixedTickGroupId: id,
            fixedTickRoundGeneration: 1,
            fixedTickGroupChunkIndex: 0,
            fixedTickGroupChunkCount: 1,
            fixedTickGroupFinal: true,
        });
        processFfaInputBatch(host, 'PEER', fresh(1), 1000);
        processFfaInputBatch(host, 'PEER', fresh(2), 1000);

        expect(host.processPlayerInput.mock.calls.map((call) => call[2].seq)).toEqual([1, 2]);
        expect(host.kickPlayer).not.toHaveBeenCalled();
        expect(host._recordNetEvent).toHaveBeenCalledWith('input_rejected', {
            steamId: 'PEER', reason: 'fixed_input_round',
        });
    });

    it('rejects stale grouped legacy input before dispatching it to a reset board', () => {
        const host = {
            isHost: true,
            _fixedTickEnabled: false,
            roundGeneration: 2,
            players: new Map([['PEER', { lastInputSeq: 0 }]]),
            processPlayerInput: vi.fn(),
            _recordNetEvent: vi.fn(),
        };
        processFfaInputBatch(host, 'PEER', {
            inputs: [{ type: 'move', data: { direction: -1 }, seq: 9 }],
            fixedTickGroupId: 9,
            fixedTickRoundGeneration: 1,
            fixedTickGroupChunkIndex: 0,
            fixedTickGroupChunkCount: 1,
            fixedTickGroupFinal: true,
        }, 1000);

        expect(host.processPlayerInput).not.toHaveBeenCalled();
        expect(host._recordNetEvent).toHaveBeenCalledWith('input_rejected', {
            steamId: 'PEER', reason: 'fixed_input_round',
        });
    });

    it('rejects a legacy sequence gap and starts recovery until history fills it', () => {
        const host = {
            isHost: true,
            localPlayerId: 'HOST',
            gamePhase: 'playing',
            _fixedTickEnabled: false,
            roundGeneration: 2,
            players: new Map([['PEER', { isAlive: true, lastInputSeq: 0 }]]),
            hostResyncInputBarriers: new Map(),
            pendingResyncs: [],
            processPlayerInput: vi.fn(),
            _recordNetEvent: vi.fn(),
            network: { sendP2PMessage: vi.fn() },
        };
        const packet = (groupId, seq) => ({
            inputs: [{ type: 'move', data: { direction: -1 }, seq }],
            fixedTickGroupId: groupId,
            fixedTickRoundGeneration: 2,
            fixedTickGroupChunkIndex: 0,
            fixedTickGroupChunkCount: 1,
            fixedTickGroupFinal: true,
        });

        processFfaInputBatch(host, 'PEER', packet(2, 2), 1000);
        expect(host.processPlayerInput).not.toHaveBeenCalled();
        expect(host._recordNetEvent).toHaveBeenCalledWith('input_rejected', {
            steamId: 'PEER', reason: 'legacy_input_gap',
        });
        expect(host.network.sendP2PMessage).toHaveBeenCalledWith(
            'PEER',
            MessageTypes.GAME_STATE_RESYNC_PREPARE,
            expect.objectContaining({ inputFencePlayerId: 'PEER' }),
        );

        processFfaInputBatch(host, 'PEER', packet(3, 1), 1001);
        processFfaInputBatch(host, 'PEER', packet(4, 2), 1002);
        expect(host.processPlayerInput.mock.calls.map((call) => call[2].seq)).toEqual([1, 2]);
    });

    it('trims a received legacy prefix when recovery replays the missing suffix', () => {
        const host = {
            isHost: true,
            _fixedTickEnabled: false,
            roundGeneration: 2,
            players: new Map([['PEER', { lastInputSeq: 0 }]]),
            processPlayerInput: vi.fn(),
            _recordNetEvent: vi.fn(),
        };
        const packet = (groupId, inputs) => ({
            inputs,
            fixedTickGroupId: groupId,
            fixedTickRoundGeneration: 2,
            fixedTickGroupChunkIndex: 0,
            fixedTickGroupChunkCount: 1,
            fixedTickGroupFinal: true,
        });
        const input = (seq) => ({ type: 'move', data: { direction: -1 }, seq });

        processFfaInputBatch(host, 'PEER', packet(1, [input(1)]), 1000);
        processFfaInputBatch(host, 'PEER', packet(3, [input(1), input(2)]), 1001);

        expect(host.processPlayerInput.mock.calls.map((call) => call[2].seq)).toEqual([1, 2]);
    });

    it('splits an ordered stream at the host validation limit', () => {
        const game = createGame(41);

        expect(flushFfaInputBatches(game)).toBe(3);

        const { calls } = game.network.sendP2PMessage.mock;
        expect(calls.map(([, , payload]) => payload.inputs.length)).toEqual([20, 20, 1]);
        expect(calls.flatMap(([, , payload]) => payload.inputs.map(({ seq }) => seq)))
            .toEqual(Array.from({ length: 41 }, (_, index) => index + 1));
        expect(new Set(calls.map(([, , payload]) => payload.fixedTickGroupId)).size).toBe(1);
        expect(calls.map(([, , payload]) => payload.fixedTickGroupChunkIndex))
            .toEqual([0, 1, 2]);
        expect(calls.map(([, , payload]) => payload.fixedTickGroupChunkCount))
            .toEqual([3, 3, 3]);
        expect(calls.map(([, , payload]) => payload.fixedTickGroupFinal))
            .toEqual([false, false, true]);
        calls.forEach(([target, type, payload]) => {
            expect(target).toBe('HOST');
            expect(type).toBe(MessageTypes.GAME_INPUT_BATCH);
            expect(payload).toMatchObject({
                lastAck: 7, tick: 9, simTick: 11, fixedTickBaseOrdinal: 1,
            });
            expect(payload.inputs.length).toBeLessThanOrEqual(FFA_INPUT_BATCH_LIMIT);
        });
        expect(game.pendingInputs).toEqual([]);
    });

    it('retains the current and later chunks when a send throws', () => {
        const game = createGame(41);
        game.network.sendP2PMessage
            .mockImplementationOnce(() => true)
            .mockImplementationOnce(() => { throw new Error('send failed'); });

        expect(() => flushFfaInputBatches(game)).toThrow('send failed');

        expect(game.pendingInputs.map(({ seq }) => seq))
            .toEqual(Array.from({ length: 21 }, (_, index) => index + 21));
        const failedPayload = game.network.sendP2PMessage.mock.calls[1][2];
        expect(game._pendingFfaInputGroup).toMatchObject({
            id: failedPayload.fixedTickGroupId,
            remaining: 21,
            chunkCount: 3,
            nextChunkIndex: 1,
            fixedTickBaseOrdinal: 1,
        });

        expect(flushFfaInputBatches(game)).toBe(2);
        const payloads = game.network.sendP2PMessage.mock.calls.map(([, , payload]) => payload);
        expect(new Set(payloads.map(({ fixedTickGroupId }) => fixedTickGroupId)).size).toBe(1);
        expect(payloads.map(({ fixedTickGroupChunkIndex }) => fixedTickGroupChunkIndex))
            .toEqual([0, 1, 1, 2]);
        expect(payloads.at(-1).fixedTickGroupFinal).toBe(true);
        expect(game.pendingInputs).toEqual([]);
        expect(game._pendingFfaInputGroup).toBeNull();
    });

    it('bounds oversized queues as independently complete groups', () => {
        const game = createGame(FFA_INPUT_GROUP_LIMIT + 1);

        flushFfaInputBatches(game);

        const payloads = game.network.sendP2PMessage.mock.calls
            .map(([, , payload]) => payload);
        const groupIds = [...new Set(payloads.map(({ fixedTickGroupId }) => fixedTickGroupId))];
        expect(groupIds).toHaveLength(2);
        groupIds.forEach((groupId) => {
            const group = payloads.filter((payload) => payload.fixedTickGroupId === groupId);
            expect(group.flatMap(({ inputs }) => inputs).length)
                .toBeLessThanOrEqual(FFA_INPUT_GROUP_LIMIT);
            expect(group.map(({ fixedTickGroupChunkIndex }) => fixedTickGroupChunkIndex))
                .toEqual(group.map((_, index) => index));
            expect(group.at(-1).fixedTickGroupFinal).toBe(true);
        });
    });

    it('keeps the exact five-tick canonical producer maximum in one group', () => {
        const inputState = createPlayerInputState({
            dasDelay: 0,
            dasInterval: 0,
            softDropInterval: 0,
        });
        inputState.das.moveLeft.active = true;
        inputState.das.moveLeft.isRepeating = true;
        inputState.das.moveRight.active = true;
        inputState.das.moveRight.isRepeating = true;
        inputState.das.softDrop.active = true;
        for (let index = 0; index < PLAYER_INPUT_EDGE_CAPACITY; index += 1) {
            enqueueInputEdge(inputState, {
                tick: 1,
                action: 'rotate',
                value: 'right',
                phase: 'down',
            });
        }

        const commands = Array.from({ length: 5 }, (_, index) => (
            advancePlayerInputTick(inputState, { tick: index + 1 })
        )).flat();
        const game = createGame(0);
        game.pendingInputs = commands.map((command, index) => ({
            type: 'drop',
            data: { type: 'soft' },
            seq: index + 1,
            fixedTickOrdinal: command.tick,
            simTick: command.tick + 10,
        }));

        expect(commands).toHaveLength(FFA_INPUT_GROUP_LIMIT);
        flushFfaInputBatches(game);
        const payloads = game.network.sendP2PMessage.mock.calls
            .map(([, , payload]) => payload);
        expect(new Set(payloads.map(({ fixedTickGroupId }) => fixedTickGroupId)).size).toBe(1);
        expect(validateFfaFixedInputGroup(
            payloads.flatMap(({ inputs }) => inputs),
            payloads.at(-1),
            true,
        )).toMatchObject({ valid: true, reason: null });
    });

    it('waits for every indexed chunk before exposing a group to scheduling', () => {
        const peer = createGame(41);
        flushFfaInputBatches(peer);
        const payloads = peer.network.sendP2PMessage.mock.calls
            .map(([, , payload]) => payload);
        const host = { _recordNetEvent: vi.fn() };

        expect(assembleFfaInputBatch(host, 'PEER', payloads[0], payloads[0].inputs))
            .toBeNull();
        expect(assembleFfaInputBatch(host, 'PEER', payloads[2], payloads[2].inputs))
            .toBeNull();
        expect(assembleFfaInputBatch(host, 'PEER', payloads[1], payloads[1].inputs))
            .toEqual(createGame(41).pendingInputs);
    });

    it('keeps a newer partial group when a delayed lower group arrives', () => {
        const peer = createGame(21);
        flushFfaInputBatches(peer);
        const payloads = peer.network.sendP2PMessage.mock.calls
            .map(([, , payload]) => payload);
        const newer = payloads.map((payload) => ({
            ...payload,
            fixedTickGroupId: 5,
        }));
        const delayedLower = {
            ...payloads[0],
            fixedTickGroupId: 4,
        };
        const host = { _recordNetEvent: vi.fn() };

        expect(assembleFfaInputBatch(host, 'PEER', newer[0], newer[0].inputs)).toBeNull();
        expect(assembleFfaInputBatch(
            host,
            'PEER',
            delayedLower,
            delayedLower.inputs,
        )).toBeNull();
        expect(assembleFfaInputBatch(host, 'PEER', newer[1], newer[1].inputs))
            .toEqual(createGame(21).pendingInputs);
        expect(host._recordNetEvent).toHaveBeenCalledWith('input_rejected', {
            steamId: 'PEER', reason: 'input_group_stale',
        });
        expect(host._recordNetEvent).not.toHaveBeenCalledWith('input_rejected', {
            steamId: 'PEER', reason: 'input_group_superseded',
        });
    });

    it('rejects incomplete or inconsistent group metadata', () => {
        const peer = createGame(21);
        flushFfaInputBatches(peer);
        const payloads = peer.network.sendP2PMessage.mock.calls
            .map(([, , payload]) => payload);
        const host = { _recordNetEvent: vi.fn() };
        const missingIndex = { ...payloads[0] };
        delete missingIndex.fixedTickGroupChunkIndex;

        expect(assembleFfaInputBatch(host, 'PEER', missingIndex, missingIndex.inputs))
            .toBeNull();
        expect(host._recordNetEvent).toHaveBeenCalledWith('input_rejected', {
            steamId: 'PEER', reason: 'input_group_metadata',
        });
    });

    it('grants canonical validation only to bounded ordered tick groups', () => {
        const game = createGame(41);
        flushFfaInputBatches(game);
        const payloads = game.network.sendP2PMessage.mock.calls
            .map(([, , payload]) => payload);
        const inputs = payloads.flatMap(({ inputs: chunk }) => chunk);
        const finalPayload = payloads.at(-1);

        expect(validateFfaFixedInputGroup(inputs, finalPayload, true))
            .toMatchObject({ valid: true, reason: null });
        expect(validateFfaFixedInputGroup(
            inputs.map((input, index) => ({
                ...input,
                fixedTickOrdinal: index === inputs.length - 1 ? 7 : input.fixedTickOrdinal,
                simTick: index === inputs.length - 1 ? 17 : input.simTick,
            })),
            finalPayload,
            true,
        )).toMatchObject({ valid: false, reason: 'fixed_input_ordinal_span' });
        expect(validateFfaFixedInputGroup(
            inputs.map((input, index) => ({
                ...input,
                seq: index === 20 ? 99 : input.seq,
            })),
            finalPayload,
            true,
        )).toMatchObject({ valid: false, reason: 'fixed_input_order' });
        expect(validateFfaFixedInputGroup(
            inputs.map((input, index) => ({
                ...input,
                simTick: index === inputs.length - 1 ? input.simTick + 1 : input.simTick,
            })),
            finalPayload,
            true,
        )).toMatchObject({ valid: false, reason: 'fixed_input_sim_tick' });
    });

    it('rejects a fixed ordinal that exceeds the producer command bound', () => {
        const inputs = Array.from({ length: FFA_INPUT_PER_ORDINAL_LIMIT + 1 }, (_, index) => ({
            type: 'drop',
            data: { type: 'soft' },
            seq: index + 1,
            fixedTickOrdinal: 1,
            simTick: 1,
        }));

        expect(validateFfaFixedInputGroup(inputs, {
            fixedTickGroupId: 1,
            fixedTickGroupChunkCount: Math.ceil(inputs.length / FFA_INPUT_BATCH_LIMIT),
            fixedTickBaseOrdinal: 1,
            fixedTickRoundGeneration: 0,
        }, true)).toMatchObject({
            valid: false,
            reason: 'fixed_input_ordinal_size',
        });
    });

    it('rejects impossible multi-ordinal and edge-only producer shapes', () => {
        const makeInput = (seq, ordinal, type = 'drop') => ({
            type,
            data: type === 'rotate' ? { direction: 'right' } : { type: 'soft' },
            seq,
            fixedTickOrdinal: ordinal,
            simTick: ordinal,
        });
        const impossible = [
            ...Array.from({ length: 104 }, (_, index) => makeInput(index + 1, 1)),
            ...Array.from({ length: 104 }, (_, index) => makeInput(index + 105, 2)),
            ...Array.from({ length: 56 }, (_, index) => makeInput(index + 209, 3)),
        ];
        const metadata = {
            fixedTickGroupId: 1,
            fixedTickGroupChunkCount: 14,
            fixedTickBaseOrdinal: 1,
            fixedTickRoundGeneration: 0,
        };

        expect(validateFfaFixedInputGroup(impossible, metadata, true)).toMatchObject({
            valid: false, reason: 'fixed_input_producer_shape',
        });
        expect(validateFfaFixedInputGroup(
            Array.from({ length: 65 }, (_, index) => makeInput(index + 1, 1, 'rotate')),
            { ...metadata, fixedTickGroupChunkCount: 4 },
            true,
        )).toMatchObject({
            valid: false, reason: 'fixed_input_producer_shape',
        });
    });

    it('recovers a forward gap and dispatches each replayed group exactly once', () => {
        const host = {
            isHost: true,
            localPlayerId: 'HOST',
            gamePhase: 'playing',
            _fixedTickEnabled: true,
            roundGeneration: 0,
            simTick: 0,
            players: new Map([['PEER', { isAlive: true, lastInputSeq: 0 }]]),
            hostResyncInputBarriers: new Map(),
            pendingResyncs: [],
            inputJitterBuffer: { currentTick: 0, processCursor: -2 },
            processPlayerInput: vi.fn(),
            _recordNetEvent: vi.fn(),
            kickPlayer: vi.fn(),
            network: { sendP2PMessage: vi.fn() },
        };
        const packet = (groupId, seq, ordinal, options = {}) => ({
            inputs: [{
                type: 'drop',
                data: { type: 'soft' },
                seq,
                fixedTickOrdinal: ordinal,
                simTick: options.simTick ?? ordinal + 99,
            }],
            fixedTickBaseOrdinal: ordinal,
            fixedTickGroupId: groupId,
            fixedTickRoundGeneration: options.roundGeneration ?? 0,
            fixedTickGroupChunkIndex: 0,
            fixedTickGroupChunkCount: 1,
            fixedTickGroupFinal: true,
        });

        const first = packet(1, 1, 1);
        processFfaInputBatch(host, 'PEER', first, 1000);
        processFfaInputBatch(host, 'PEER', first, 1000);
        expect(host.processPlayerInput).toHaveBeenCalledOnce();
        expect(host._recordNetEvent).toHaveBeenCalledWith('input_rejected', {
            steamId: 'PEER', reason: 'fixed_input_progression',
        });
        expect(host.kickPlayer).not.toHaveBeenCalled();

        processFfaInputBatch(host, 'PEER', packet(3, 3, 3), 1000);
        expect(host.processPlayerInput).toHaveBeenCalledOnce();
        expect(host._recordNetEvent).toHaveBeenCalledWith('input_rejected', {
            steamId: 'PEER', reason: 'fixed_input_progression',
        });
        expect(host.kickPlayer).not.toHaveBeenCalled();
        expect(host.network.sendP2PMessage).toHaveBeenCalledWith(
            'PEER',
            MessageTypes.GAME_STATE_RESYNC_PREPARE,
            expect.objectContaining({ inputFencePlayerId: 'PEER' }),
        );

        processFfaInputBatch(host, 'PEER', packet(2, 2, 2), 1000);
        processFfaInputBatch(host, 'PEER', packet(3, 3, 3), 1000);
        expect(host.processPlayerInput).toHaveBeenCalledTimes(3);
        expect(host.processPlayerInput.mock.calls.map((call) => call[2].seq))
            .toEqual([1, 2, 3]);
        expect(host.processPlayerInput.mock.calls.map((call) => call[2].fixedTickTargetTick))
            .toEqual([0, 1, 2]);

        for (let ordinal = 4; ordinal <= 33; ordinal += 1) {
            processFfaInputBatch(host, 'PEER', packet(ordinal, ordinal, ordinal), 1000);
        }
        processFfaInputBatch(host, 'PEER', packet(34, 34, 34), 1000);
        processFfaInputBatch(host, 'PEER', packet(35, 35, 35), 1000);
        expect(host.processPlayerInput).toHaveBeenCalledTimes(33);
        expect(host._recordNetEvent).not.toHaveBeenCalledWith('input_rejected', {
            steamId: 'PEER', reason: 'fixed_input_schedule_window',
        });

        host.inputJitterBuffer.currentTick = 2;
        host.inputJitterBuffer.processCursor = 0;
        expect(drainFfaInputBatches(host)).toBe(2);
        expect(host.processPlayerInput).toHaveBeenCalledTimes(35);
        expect(host.processPlayerInput.mock.calls.slice(-2).map(
            (call) => call[2].fixedTickTargetTick,
        )).toEqual([33, 34]);

        host.roundGeneration = 1;
        host.inputJitterBuffer.currentTick = 0;
        host.inputJitterBuffer.processCursor = -2;
        processFfaInputBatch(host, 'PEER', packet(36, 36, 1, {
            roundGeneration: 1,
            simTick: 200,
        }), 1000);
        expect(host.processPlayerInput).toHaveBeenCalledTimes(36);
        expect(host.processPlayerInput.mock.lastCall[2].fixedTickTargetTick).toBe(0);
    });

    it('trims a received fixed prefix and preserves ordinal scheduling for its suffix', () => {
        const host = {
            isHost: true,
            _fixedTickEnabled: true,
            roundGeneration: 0,
            simTick: 0,
            players: new Map([['PEER', { lastInputSeq: 0 }]]),
            inputJitterBuffer: { currentTick: 0, processCursor: -2 },
            processPlayerInput: vi.fn(),
            _recordNetEvent: vi.fn(),
            kickPlayer: vi.fn(),
        };
        const input = (seq) => ({
            type: 'drop',
            data: { type: 'soft' },
            seq,
            fixedTickOrdinal: seq,
            simTick: seq + 99,
        });
        const packet = (groupId, inputs) => ({
            inputs,
            fixedTickBaseOrdinal: inputs[0].fixedTickOrdinal,
            fixedTickGroupId: groupId,
            fixedTickRoundGeneration: 0,
            fixedTickGroupChunkIndex: 0,
            fixedTickGroupChunkCount: 1,
            fixedTickGroupFinal: true,
        });

        processFfaInputBatch(host, 'PEER', packet(1, [input(1)]), 1000);
        processFfaInputBatch(host, 'PEER', packet(3, [input(1), input(2)]), 1001);

        expect(host.processPlayerInput.mock.calls.map((call) => call[2].seq)).toEqual([1, 2]);
        expect(host.processPlayerInput.mock.lastCall[2]).toMatchObject({
            fixedTickOffset: 0,
            fixedTickTargetTick: 1,
        });
        expect(host.kickPlayer).not.toHaveBeenCalled();
    });

    it('requires the first observed group to continue the host applied sequence', () => {
        const host = {
            isHost: true,
            localPlayerId: 'HOST',
            gamePhase: 'playing',
            _fixedTickEnabled: true,
            roundGeneration: 0,
            simTick: 0,
            players: new Map([['PEER', { isAlive: true, lastInputSeq: 0 }]]),
            hostResyncInputBarriers: new Map(),
            pendingResyncs: [],
            inputJitterBuffer: { currentTick: 0, processCursor: -2 },
            processPlayerInput: vi.fn(),
            _recordNetEvent: vi.fn(),
            kickPlayer: vi.fn(),
            network: { sendP2PMessage: vi.fn() },
        };
        const packet = (groupId, seq) => ({
            inputs: [{
                type: 'drop',
                data: { type: 'soft' },
                seq,
                fixedTickOrdinal: seq,
                simTick: seq,
            }],
            fixedTickBaseOrdinal: seq,
            fixedTickGroupId: groupId,
            fixedTickRoundGeneration: 0,
            fixedTickGroupChunkIndex: 0,
            fixedTickGroupChunkCount: 1,
            fixedTickGroupFinal: true,
        });

        processFfaInputBatch(host, 'PEER', packet(2, 2), 1000);
        expect(host.processPlayerInput).not.toHaveBeenCalled();
        expect(host._recordNetEvent).toHaveBeenCalledWith('input_rejected', {
            steamId: 'PEER', reason: 'fixed_input_progression',
        });
        expect(host.kickPlayer).not.toHaveBeenCalled();
        expect(host.network.sendP2PMessage).toHaveBeenCalledWith(
            'PEER',
            MessageTypes.GAME_STATE_RESYNC_PREPARE,
            expect.objectContaining({ inputFencePlayerId: 'PEER' }),
        );

        processFfaInputBatch(host, 'PEER', packet(1, 1), 1000);
        processFfaInputBatch(host, 'PEER', packet(2, 2), 1000);
        expect(host.processPlayerInput.mock.calls.map((call) => call[2].seq)).toEqual([1, 2]);
    });

    it('keeps impossible same-round fixed chronology fatal', () => {
        const host = {
            isHost: true,
            _fixedTickEnabled: true,
            roundGeneration: 0,
            simTick: 0,
            players: new Map([['PEER', { lastInputSeq: 0 }]]),
            inputJitterBuffer: { currentTick: 0, processCursor: -2 },
            processPlayerInput: vi.fn(),
            _recordNetEvent: vi.fn(),
            kickPlayer: vi.fn(),
        };
        const packet = (groupId, seq, simTick) => ({
            inputs: [{
                type: 'drop',
                data: { type: 'soft' },
                seq,
                fixedTickOrdinal: seq,
                simTick,
            }],
            fixedTickBaseOrdinal: seq,
            fixedTickGroupId: groupId,
            fixedTickRoundGeneration: 0,
            fixedTickGroupChunkIndex: 0,
            fixedTickGroupChunkCount: 1,
            fixedTickGroupFinal: true,
        });

        processFfaInputBatch(host, 'PEER', packet(1, 1, 100), 1000);
        processFfaInputBatch(host, 'PEER', packet(2, 2, 100), 1001);

        expect(host.processPlayerInput).toHaveBeenCalledOnce();
        expect(host.kickPlayer).toHaveBeenCalledWith('PEER', 'fixed_input_continuity_gap');
    });

    it('does not let a forward sequence gap mask impossible fixed chronology', () => {
        const host = {
            isHost: true,
            localPlayerId: 'HOST',
            gamePhase: 'playing',
            _fixedTickEnabled: true,
            roundGeneration: 0,
            simTick: 0,
            players: new Map([['PEER', { isAlive: true, lastInputSeq: 0 }]]),
            hostResyncInputBarriers: new Map(),
            pendingResyncs: [],
            inputJitterBuffer: { currentTick: 0, processCursor: -2 },
            processPlayerInput: vi.fn(),
            _recordNetEvent: vi.fn(),
            kickPlayer: vi.fn(),
            network: { sendP2PMessage: vi.fn() },
        };
        const packet = (groupId, seq, simTick) => ({
            inputs: [{
                type: 'drop',
                data: { type: 'soft' },
                seq,
                fixedTickOrdinal: seq,
                simTick,
            }],
            fixedTickBaseOrdinal: seq,
            fixedTickGroupId: groupId,
            fixedTickRoundGeneration: 0,
            fixedTickGroupChunkIndex: 0,
            fixedTickGroupChunkCount: 1,
            fixedTickGroupFinal: true,
        });

        processFfaInputBatch(host, 'PEER', packet(1, 1, 100), 1000);
        processFfaInputBatch(host, 'PEER', packet(3, 3, 100), 1001);

        expect(host.processPlayerInput).toHaveBeenCalledOnce();
        expect(host.kickPlayer).toHaveBeenCalledWith('PEER', 'fixed_input_continuity_gap');
        expect(host.network.sendP2PMessage).not.toHaveBeenCalled();
    });

    it('keeps consecutive groups on distinct persistent host schedule ticks', () => {
        const scheduled = [];
        const host = {
            isHost: true,
            _fixedTickEnabled: true,
            roundGeneration: 0,
            simTick: 500,
            players: new Map([['PEER', { lastInputSeq: 0 }]]),
            inputJitterBuffer: { currentTick: 100, processCursor: 98 },
            processPlayerInput: vi.fn((_steamId, _type, data) => scheduled.push(data)),
            _recordNetEvent: vi.fn(),
        };
        const packet = (groupId, simTick) => ({
            inputs: [{
                type: 'drop',
                data: { type: 'soft' },
                seq: groupId,
                fixedTickOrdinal: groupId,
                simTick,
            }],
            fixedTickBaseOrdinal: groupId,
            fixedTickGroupId: groupId,
            fixedTickRoundGeneration: 0,
            fixedTickGroupChunkIndex: 0,
            fixedTickGroupChunkCount: 1,
            fixedTickGroupFinal: true,
        });

        processFfaInputBatch(host, 'PEER', packet(1, 700), 1000);
        processFfaInputBatch(host, 'PEER', packet(2, 701), 1000);

        expect(scheduled.map(({ fixedTickTargetTick }) => fixedTickTargetTick))
            .toEqual([100, 101]);
    });

    it('rebases same-round scheduling when the jitter buffer epoch is cleared at zero', () => {
        const scheduled = [];
        const host = {
            isHost: true,
            _fixedTickEnabled: true,
            roundGeneration: 0,
            players: new Map([['PEER', { lastInputSeq: 0 }]]),
            inputJitterBuffer: { currentTick: 0, processCursor: -2, clockEpoch: 0 },
            processPlayerInput: vi.fn((_steamId, _type, data) => scheduled.push(data)),
            _recordNetEvent: vi.fn(),
        };
        const packet = (id) => ({
            inputs: [{
                type: 'drop', data: { type: 'soft' }, seq: id, fixedTickOrdinal: id, simTick: id,
            }],
            fixedTickBaseOrdinal: id,
            fixedTickGroupId: id,
            fixedTickRoundGeneration: 0,
            fixedTickGroupChunkIndex: 0,
            fixedTickGroupChunkCount: 1,
            fixedTickGroupFinal: true,
        });

        processFfaInputBatch(host, 'PEER', packet(1), 1000);
        host.inputJitterBuffer.clockEpoch += 1;
        processFfaInputBatch(host, 'PEER', packet(2), 1000);

        expect(scheduled.map(({ fixedTickTargetTick }) => fixedTickTargetTick)).toEqual([0, 0]);
    });

    it('disconnects explicitly instead of wedging continuity on pending overflow', () => {
        const host = {
            isHost: true,
            _fixedTickEnabled: true,
            roundGeneration: 0,
            players: new Map([['PEER', { lastInputSeq: 0 }]]),
            inputJitterBuffer: { currentTick: 0, processCursor: -2, clockEpoch: 0 },
            processPlayerInput: vi.fn(),
            _recordNetEvent: vi.fn(),
            kickPlayer: vi.fn(),
        };
        for (let groupId = 1; groupId <= 300 && !host.kickPlayer.mock.calls.length; groupId += 1) {
            const inputs = Array.from({ length: 20 }, (_, index) => ({
                type: 'drop',
                data: { type: 'soft' },
                seq: ((groupId - 1) * 20) + index + 1,
                fixedTickOrdinal: groupId,
                simTick: groupId,
            }));
            processFfaInputBatch(host, 'PEER', {
                inputs,
                fixedTickBaseOrdinal: groupId,
                fixedTickGroupId: groupId,
                fixedTickRoundGeneration: 0,
                fixedTickGroupChunkIndex: 0,
                fixedTickGroupChunkCount: 1,
                fixedTickGroupFinal: true,
            }, 1000);
        }

        expect(host._recordNetEvent).toHaveBeenCalledWith('input_rejected', {
            steamId: 'PEER', reason: 'fixed_input_pending_overflow',
        });
        expect(host.kickPlayer).toHaveBeenCalledWith(
            'PEER',
            'fixed_input_backpressure_overflow',
        );
    });

    it('deduplicates a blocked complete group without consuming pending capacity', () => {
        const host = {
            isHost: true,
            _fixedTickEnabled: true,
            roundGeneration: 0,
            players: new Map([['PEER', { lastInputSeq: 0 }]]),
            inputJitterBuffer: { currentTick: 0, processCursor: -2, clockEpoch: 0 },
            processPlayerInput: vi.fn(),
            _recordNetEvent: vi.fn(),
            kickPlayer: vi.fn(),
        };
        const packet = (id) => ({
            inputs: [{
                type: 'drop', data: { type: 'soft' }, seq: id, fixedTickOrdinal: id, simTick: id,
            }],
            fixedTickBaseOrdinal: id,
            fixedTickGroupId: id,
            fixedTickRoundGeneration: 0,
            fixedTickGroupChunkIndex: 0,
            fixedTickGroupChunkCount: 1,
            fixedTickGroupFinal: true,
        });
        for (let id = 1; id <= 34; id += 1) {
            processFfaInputBatch(host, 'PEER', packet(id), 1000);
        }
        for (let retry = 0; retry < 300; retry += 1) {
            processFfaInputBatch(host, 'PEER', packet(34), 1000);
        }

        expect(host.processPlayerInput).toHaveBeenCalledTimes(33);
        expect(host.kickPlayer).not.toHaveBeenCalled();
        expect(host._recordNetEvent).toHaveBeenCalledWith('input_rejected', {
            steamId: 'PEER', reason: 'fixed_input_pending_duplicate',
        });

        host.inputJitterBuffer.currentTick = 1;
        host.inputJitterBuffer.processCursor = -1;
        expect(drainFfaInputBatches(host)).toBe(1);
        expect(host.processPlayerInput).toHaveBeenCalledTimes(34);
    });

    it.each([30, 60, 144])(
        'keeps instant-SDF catch-up batches valid at %i Hz render cadence',
        (renderRate) => {
            const game = createGame(0);
            let accumulatorMs = 0;
            let seq = 0;
            let tick = 0;

            for (let frame = 0; frame < renderRate; frame += 1) {
                const plan = planFixedTicks(accumulatorMs, 1000 / renderRate, { maxSteps: 5 });
                accumulatorMs = plan.remainderMs;
                for (let step = 0; step < plan.steps; step += 1) {
                    tick += 1;
                    for (let repeat = 0; repeat < 21; repeat += 1) {
                        seq += 1;
                        game.pendingInputs.push({
                            seq,
                            fixedTickOrdinal: tick,
                            simTick: tick,
                            type: 'drop',
                            data: { type: 'soft' },
                        });
                    }
                }
                flushFfaInputBatches(game);
            }

            const payloads = game.network.sendP2PMessage.mock.calls
                .map(([, , payload]) => payload);
            expect(tick).toBe(60);
            expect(payloads.every(
                ({ inputs }) => inputs.length <= FFA_INPUT_BATCH_LIMIT,
            )).toBe(true);
            expect(payloads.flatMap(({ inputs }) => inputs.map((input) => input.seq)))
                .toEqual(Array.from({ length: 60 * 21 }, (_, index) => index + 1));
            expect(game.pendingInputs).toEqual([]);
        },
    );
});
